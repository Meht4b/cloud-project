import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const DATA_DIR = resolve(ROOT, ".local-data");
const DB_PATH = resolve(DATA_DIR, "goodtable.json");
const KEY_PATH = resolve(DATA_DIR, "session.key");
const PORT = Number(process.env.PORT || 8080);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
const publicFiles = new Set(["/", "/index.html", "/styles.css", "/app.js"]);
let signingKey;
let db;

const id = () => randomBytes(12).toString("hex");
const now = () => new Date().toISOString();
const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);
function coordinates(latInput, lonInput) {
  const latBlank = latInput === "" || latInput == null;
  const lonBlank = lonInput === "" || lonInput == null;
  if (latBlank && lonBlank) return { latitude: null, longitude: null };
  const latitude = Number(latInput), longitude = Number(lonInput);
  if (latBlank || lonBlank || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error("Enter both valid map coordinates, or leave both blank.");
  return { latitude, longitude };
}

function passwordRecord(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, record) {
  const candidate = scryptSync(password, record.salt, 64);
  const expected = Buffer.from(record.hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function publicUser(user) {
  const { password, ...safe } = user;
  return safe;
}

function tokenFor(user) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Date.now() + 7 * 864e5 })).toString("base64url");
  const signature = createHmac("sha256", signingKey).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function userFromRequest(request) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("gt_session="));
  if (!cookie) return null;
  try {
    const [payload, signature] = cookie.slice("gt_session=".length).split(".");
    const expected = createHmac("sha256", signingKey).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (session.exp < Date.now()) return null;
    return db.users.find((user) => user.id === session.sub) ?? null;
  } catch {
    return null;
  }
}

async function persist() {
  await writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

async function initialize() {
  await mkdir(DATA_DIR, { recursive: true });
  try { signingKey = await readFile(KEY_PATH); } catch {
    signingKey = randomBytes(32);
    await writeFile(KEY_PATH, signingKey, { mode: 0o600 });
  }
  try { db = JSON.parse(await readFile(DB_PATH, "utf8")); } catch {
    const demoPassword = "GoodTableDemo!26";
    const restaurant = { id: id(), email: "restaurant@goodtable.demo", password: passwordRecord(demoPassword), role: "restaurant", name: "Green Basket Market", phone: "+91 98765 43210", city: "Bengaluru", address: "12, 8th Main Road, Malleshwaram", postalCode: "560003", latitude: 13.0031, longitude: 77.5703, createdAt: now() };
    const bakery = { id: id(), email: "bakery@goodtable.demo", password: passwordRecord(demoPassword), role: "restaurant", name: "Daily Bread Co.", phone: "+91 98765 43211", city: "Bengaluru", address: "44, V V Puram Main Road", postalCode: "560004", latitude: 12.9432, longitude: 77.5685, createdAt: now() };
    const partner = { id: id(), email: "partner@goodtable.demo", password: passwordRecord(demoPassword), role: "partner", name: "Amara's Community Kitchen", phone: "+91 98765 40000", city: "Bengaluru", address: "5, Cubbon Road", postalCode: "560001", latitude: 12.9756, longitude: 77.605, createdAt: now() };
    const listing = (restaurantUser, values) => ({ id: id(), restaurantId: restaurantUser.id, restaurantName: restaurantUser.name, city: restaurantUser.city, address: restaurantUser.address, latitude: restaurantUser.latitude, longitude: restaurantUser.longitude, ...values, status: "available", createdAt: now(), updatedAt: now(), claimedBy: null, claimedAt: null });
    db = { users: [restaurant, bakery, partner], listings: [
      listing(restaurant, { name: "Seasonal greens & herbs", category: "Produce", quantity: "8 crates", servings: 32, pickupStart: "15:00", pickupEnd: "17:00", bestBefore: "Today", allergens: "None declared", notes: "Washed and packed this morning.", image: "🥬" }),
      listing(bakery, { name: "Fresh sourdough & pastries", category: "Bakery", quantity: "14 bags", servings: 20, pickupStart: "16:00", pickupEnd: "18:00", bestBefore: "Today", allergens: "Wheat, gluten", notes: "Please bring reusable bags.", image: "🥐" }),
      listing(restaurant, { name: "Ripe fruit mix", category: "Produce", quantity: "6 boxes", servings: 18, pickupStart: "17:00", pickupEnd: "19:00", bestBefore: "Tomorrow", allergens: "None declared", notes: "Seasonal fruit, mixed box.", image: "🍎" })
    ], pickups: [] };
    await persist();
  }
}

function sendJson(response, status, data, extraHeaders = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
  response.end(JSON.stringify(data));
}

async function bodyJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request body is too large.");
  }
  return body ? JSON.parse(body) : {};
}

function requireUser(user, response) {
  if (!user) { sendJson(response, 401, { error: "Sign in to continue." }); return false; }
  return true;
}

function requireRole(user, role, response) {
  if (!requireUser(user, response)) return false;
  if (user.role !== role) { sendJson(response, 403, { error: "This action is not available for your account type." }); return false; }
  return true;
}

function safeListing(item, user) {
  const { address, ...listing } = item;
  return { ...listing, address: user?.role === "restaurant" && user.id === item.restaurantId || item.claimedBy === user?.id ? address : null };
}

function distanceKm(a, b) {
  if (typeof a.latitude !== "number" || typeof a.longitude !== "number" || typeof b.latitude !== "number" || typeof b.longitude !== "number") return null;
  const rad = (deg) => deg * Math.PI / 180;
  const lat1 = rad(a.latitude), lat2 = rad(b.latitude), dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 10) / 10;
}

async function handleApi(request, response, url) {
  const { pathname, searchParams } = url;
  const user = userFromRequest(request);
  const method = request.method;

  if (pathname === "/api/health" && method === "GET") return sendJson(response, 200, { status: "ok" });
  if (pathname === "/api/auth/register" && method === "POST") {
    const input = await bodyJson(request);
    const email = clean(input.email, 254).toLowerCase();
    const password = String(input.password ?? "");
    const role = input.role;
    if (!email.includes("@") || password.length < 10 || !["restaurant", "partner"].includes(role)) return sendJson(response, 400, { error: "Enter a valid email, choose an account type, and use a password with at least 10 characters." });
    if (db.users.some((entry) => entry.email === email)) return sendJson(response, 409, { error: "An account with that email already exists." });
    let pin;
    try { pin = coordinates(input.latitude, input.longitude); } catch (error) { return sendJson(response, 400, { error: error.message }); }
    const profile = { id: id(), email, password: passwordRecord(password), role, name: clean(input.name, 100), phone: clean(input.phone, 30), city: clean(input.city, 100), address: clean(input.address, 200), postalCode: clean(input.postalCode, 20), ...pin, createdAt: now() };
    if (!profile.name || !profile.city || (role === "restaurant" && !profile.address)) return sendJson(response, 400, { error: role === "restaurant" ? "Business name, city, and pickup address are required." : "Organization name and city are required." });
    db.users.push(profile); await persist();
    return sendJson(response, 201, { user: publicUser(profile) }, { "Set-Cookie": `gt_session=${tokenFor(profile)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` });
  }
  if (pathname === "/api/auth/login" && method === "POST") {
    const input = await bodyJson(request);
    const targetEmail = clean(input.email, 254).toLowerCase();
    const account = db.users.find((entry) => entry.email === targetEmail);
    if (!account || !verifyPassword(String(input.password ?? ""), account.password)) return sendJson(response, 401, { error: "Email or password is incorrect." });
    return sendJson(response, 200, { user: publicUser(account) }, { "Set-Cookie": `gt_session=${tokenFor(account)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` });
  }
  if (pathname === "/api/auth/logout" && method === "POST") return sendJson(response, 200, { ok: true }, { "Set-Cookie": "gt_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
  if (pathname === "/api/me" && method === "GET") return sendJson(response, user ? 200 : 401, user ? { user: publicUser(user) } : { error: "Not signed in." });
  if (pathname === "/api/me" && method === "PATCH") {
    if (!requireUser(user, response)) return;
    const input = await bodyJson(request);
    for (const key of ["name", "phone", "city", "address", "postalCode"]) if (input[key] !== undefined) user[key] = clean(input[key], key === "address" ? 200 : 100);
    if (input.latitude !== undefined || input.longitude !== undefined) {
      try {
        const pin = coordinates(input.latitude !== undefined ? input.latitude : user.latitude, input.longitude !== undefined ? input.longitude : user.longitude);
        user.latitude = pin.latitude; user.longitude = pin.longitude;
      } catch (error) { return sendJson(response, 400, { error: error.message }); }
    }
    for (const listing of db.listings) {
      if (listing.restaurantId === user.id && listing.status === "available") {
        listing.restaurantName = user.name; listing.city = user.city; listing.address = user.address;
        listing.latitude = user.latitude; listing.longitude = user.longitude;
      }
    }
    await persist();
    return sendJson(response, 200, { user: publicUser(user) });
  }
  if (pathname === "/api/listings" && method === "GET") {
    const query = clean(searchParams.get("q"), 100).toLowerCase();
    const category = clean(searchParams.get("category"), 40);
    const city = clean(searchParams.get("city"), 100).toLowerCase();
    const status = clean(searchParams.get("status"), 40);
    let rows = db.listings.filter((item) => (!status || item.status === status) && (!category || item.category === category) && (!city || item.city.toLowerCase() === city) && (!query || `${item.name} ${item.restaurantName} ${item.category} ${item.city}`.toLowerCase().includes(query)));
    if (user?.role === "partner" && typeof user.latitude === "number") rows = rows.map((item) => ({ ...item, distanceKm: distanceKm(user, item) })).sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    return sendJson(response, 200, { listings: rows.map((item) => safeListing(item, user)) });
  }
  if (pathname === "/api/listings" && method === "POST") {
    if (!requireRole(user, "restaurant", response)) return;
    const input = await bodyJson(request);
    const name = clean(input.name, 120), category = clean(input.category, 40), quantity = clean(input.quantity, 80);
    if (!name || !quantity || !["Produce", "Bakery", "Prepared meals", "Dairy", "Pantry", "Other"].includes(category)) return sendJson(response, 400, { error: "Food name, valid category, and quantity are required." });
    const latitude = user.latitude, longitude = user.longitude;
    const entry = { id: id(), restaurantId: user.id, restaurantName: user.name, city: user.city, address: user.address, latitude, longitude, name, category, quantity, servings: Number(input.servings) || 0, pickupStart: clean(input.pickupStart, 5), pickupEnd: clean(input.pickupEnd, 5), bestBefore: clean(input.bestBefore, 30), allergens: clean(input.allergens, 180), notes: clean(input.notes, 500), image: clean(input.image, 4) || "🍽️", status: "available", createdAt: now(), updatedAt: now(), claimedBy: null, claimedAt: null };
    db.listings.unshift(entry); await persist();
    return sendJson(response, 201, { listing: safeListing(entry, user) });
  }
  if (pathname === "/api/my/listings" && method === "GET") {
    if (!requireRole(user, "restaurant", response)) return;
    return sendJson(response, 200, { listings: db.listings.filter((item) => item.restaurantId === user.id).map((item) => safeListing(item, user)) });
  }
  const claimMatch = pathname.match(/^\/api\/listings\/([a-f0-9]+)\/claim$/);
  if (claimMatch && method === "POST") {
    if (!requireRole(user, "partner", response)) return;
    const item = db.listings.find((entry) => entry.id === claimMatch[1]);
    if (!item) return sendJson(response, 404, { error: "Listing not found." });
    if (item.status !== "available") return sendJson(response, 409, { error: "This food has already been claimed or is no longer available." });
    item.status = "claimed"; item.claimedBy = user.id; item.claimedAt = now();
    const pickup = { id: id(), listingId: item.id, partnerId: user.id, restaurantId: item.restaurantId, status: "confirmed", createdAt: now() };
    db.pickups.push(pickup); await persist();
    return sendJson(response, 201, { pickup: { ...pickup, listing: safeListing(item, user) } });
  }
  if (pathname === "/api/my/pickups" && method === "GET") {
    if (!requireUser(user, response)) return;
    const rows = user.role === "partner" ? db.pickups.filter((entry) => entry.partnerId === user.id) : db.pickups.filter((entry) => entry.restaurantId === user.id);
    return sendJson(response, 200, { pickups: rows.map((pickup) => ({ ...pickup, listing: safeListing(db.listings.find((item) => item.id === pickup.listingId), user) })) });
  }
  if (pathname === "/api/notifications" && method === "GET") {
    if (!requireUser(user, response)) return;
    const ownedPickups = user.role === "restaurant" ? db.pickups.filter((entry) => entry.restaurantId === user.id) : db.pickups.filter((entry) => entry.partnerId === user.id);
    const items = [];
    for (const pickup of ownedPickups) {
      const listing = db.listings.find((entry) => entry.id === pickup.listingId);
      if (!listing) continue;
      if (user.role === "restaurant") {
        items.push({ id: `${pickup.id}-claimed`, title: "Food claimed", message: `${listing.name} was claimed by a community partner.`, at: pickup.createdAt, icon: "♡", href: "#/pickups" });
        if (listing.status === "completed") items.push({ id: `${pickup.id}-completed`, title: "Pickup completed", message: `${listing.name} has been marked as collected.`, at: listing.updatedAt || pickup.createdAt, icon: "✓", href: "#/pickups" });
      } else {
        items.push({ id: `${pickup.id}-confirmed`, title: "Pickup confirmed", message: `Your pickup for ${listing.name} is confirmed.`, at: pickup.createdAt, icon: "⌖", href: "#/pickups" });
        if (listing.status === "completed") items.push({ id: `${pickup.id}-completed`, title: "Food collected", message: `${listing.name} is marked as completed.`, at: listing.updatedAt || pickup.createdAt, icon: "✓", href: "#/pickups" });
      }
    }
    items.sort((a, b) => new Date(b.at) - new Date(a.at));
    const readAt = user.notificationsReadAt ? new Date(user.notificationsReadAt).getTime() : 0;
    const visibleItems = items.slice(0, 12).map((item) => ({ ...item, unread: new Date(item.at).getTime() > readAt }));
    return sendJson(response, 200, { unreadCount: visibleItems.filter((item) => item.unread).length, readAt: user.notificationsReadAt || null, items: visibleItems });
  }
  if (pathname === "/api/notifications/read" && method === "POST") {
    if (!requireUser(user, response)) return;
    user.notificationsReadAt = now(); await persist();
    return sendJson(response, 200, { ok: true, readAt: user.notificationsReadAt });
  }
  const statusMatch = pathname.match(/^\/api\/listings\/([a-f0-9]+)\/status$/);
  if (statusMatch && method === "PATCH") {
    if (!requireRole(user, "restaurant", response)) return;
    const item = db.listings.find((entry) => entry.id === statusMatch[1]);
    if (!item) return sendJson(response, 404, { error: "Listing not found." });
    if (item.restaurantId !== user.id) return sendJson(response, 403, { error: "You can only update your own listings." });
    const { status } = await bodyJson(request);
    if (!["available", "completed", "cancelled"].includes(status)) return sendJson(response, 400, { error: "Choose a valid listing status." });
    item.status = status; item.updatedAt = now(); await persist();
    return sendJson(response, 200, { listing: safeListing(item, user) });
  }
  if (pathname === "/api/impact" && method === "GET") {
    const mine = user ? db.listings.filter((item) => user.role === "restaurant" ? item.restaurantId === user.id : item.claimedBy === user.id) : db.listings;
    const nearbyAvailable = user?.role === "partner" ? db.listings.filter((item) => item.status === "available" && item.city.toLowerCase() === user.city.toLowerCase()) : mine.filter((item) => item.status === "available");
    const rescued = mine.filter((item) => ["claimed", "completed"].includes(item.status));
    return sendJson(response, 200, { activeListings: nearbyAvailable.length, rescuedListings: rescued.length, meals: rescued.reduce((sum, item) => sum + (item.servings || 0), 0), foodKg: rescued.reduce((sum, item) => sum + (Number.parseInt(item.quantity, 10) || 0), 0) });
  }
  return sendJson(response, 404, { error: "That page or API route does not exist." });
}

async function main() {
  await initialize();
  createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
      if (!publicFiles.has(url.pathname)) return response.writeHead(404).end("Not found");
      const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      const file = resolve(ROOT, `.${requested}`);
      if (file !== ROOT && !file.startsWith(`${ROOT}${sep}`)) return response.writeHead(403).end("Forbidden");
      const content = await readFile(file);
      response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
      response.end(content);
    } catch (error) {
      if (error instanceof SyntaxError) return sendJson(response, 400, { error: "Request body must be valid JSON." });
      console.error(error);
      sendJson(response, 500, { error: "Something went wrong. Please try again." });
    }
  }).listen(PORT, "127.0.0.1", () => console.log(`GoodTable app running at http://127.0.0.1:${PORT}`));
}

main();
