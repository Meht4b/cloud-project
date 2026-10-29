import { auth, beginSignIn, finishAuthRedirect, signOutFromCognito } from "./auth.js";

const app = document.querySelector("#app");
const toastNode = document.querySelector("#toast");
let currentUser = null;
let toastTimer;
let authMode = "login";
let authRole = "partner";
let discoverFilters = { q: "", category: "", city: "", savedOnly: false };
let notificationState = { unreadCount: 0, items: [], readAt: null };
let profileDraft = {};
const API_URL = (import.meta.env.VITE_API_URL || "https://doxaanle49.execute-api.ap-south-1.amazonaws.com").replace(/\/$/, "");

const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const initials = (name = "GT") => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
const roleLabel = (role) => role === "restaurant" ? "Restaurant partner" : "Community partner";
const dateLabel = (value) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
const prettyTime = (value) => value ? new Date(`2020-01-01T${value}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Time not set";
const relativeTime = (value) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};
function savedListingIds() {
  try { return new Set(JSON.parse(localStorage.getItem(`goodtable:saved:${currentUser?.id}`) || "[]")); }
  catch { return new Set(); }
}
function saveListing(id) {
  const saved = savedListingIds();
  if (saved.has(id)) saved.delete(id); else saved.add(id);
  localStorage.setItem(`goodtable:saved:${currentUser.id}`, JSON.stringify([...saved]));
  return saved.has(id);
}

async function api(path, options = {}) {
  let response;
  try {
    const cognitoUser = await auth.getUser();
    response = await fetch(`${API_URL}/api${path}`, { ...options, headers: { "Content-Type": "application/json", ...(cognitoUser?.access_token ? { Authorization: `Bearer ${cognitoUser.access_token}` } : {}), ...(options.headers || {}) } });
  } catch {
    throw new Error("Could not reach GoodTable. Check your connection and try again.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error || "The request could not be completed."); error.status = response.status; error.payload = payload; throw error; }
  return payload;
}

function toast(message, kind = "") {
  toastNode.textContent = message;
  toastNode.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastNode.className = "toast"; }, 3200);
}

function brand() { return `<a class="brand" href="#/" aria-label="GoodTable home"><span class="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 26c-6.1-3.8-9.2-8.2-9.2-13.1 0-3.2 2.2-5.5 5.1-5.5 2 0 3.4 1 4.1 2.6.7-1.6 2.1-2.6 4.1-2.6 2.9 0 5.1 2.3 5.1 5.5C25.2 17.8 22.1 22.2 16 26Z"/><path d="M16 23V11"/></svg></span><span>goodtable<span class="brand-period">.</span></span></a>`; }

function renderAuth() {
  const isProfile = authMode === "profile";
  const isSignup = authMode === "signup" || isProfile;
  app.innerHTML = `<main class="auth-layout">
    <section class="auth-story"><div class="auth-story-inner">${brand()}<div class="story-copy"><div class="story-tag"><i></i> GOOD FOOD. BETTER TOGETHER.</div><h1>Make good food<br>go further.</h1><p>Every meal saved is a little more hope on someone's table and a little less waste in our world.</p><div class="story-impact"><div><strong>1,284</strong><span>meals rescued</span></div><b></b><div><strong>32</strong><span>local partners</span></div><b></b><div><strong>486 kg</strong><span>food diverted</span></div></div><div class="food-orbit"><span class="orbit-circle circle-one"></span><span class="orbit-circle circle-two"></span><span class="orbit-emoji emoji-one">🥑</span><span class="orbit-emoji emoji-two">🍅</span><span class="orbit-emoji emoji-three">🥕</span><span class="orbit-emoji emoji-four">🥬</span><span class="orbit-center">♡</span></div><div class="story-caption">A community-powered food rescue network <span>✳</span></div></div></div></section>
    <section class="auth-panel"><div class="auth-card"><div class="auth-mobile-brand">${brand()}</div><div class="auth-heading"><span class="section-kicker">${isProfile ? "ONE LAST STEP" : isSignup ? "JOIN THE COMMUNITY" : "WELCOME BACK"}</span><h2>${isProfile ? "Complete your profile" : isSignup ? "Create your account" : "Sign in to GoodTable"}</h2><p>${isProfile ? "Choose your role and add your organization details." : isSignup ? "Choose your role and let's make a difference together." : "Continue securely with your GoodTable account."}</p></div>
      ${!isProfile ? `<div class="auth-tabs"><button class="${authMode === "login" ? "active" : ""}" data-auth-mode="login">Sign in</button><button class="${authMode === "signup" ? "active" : ""}" data-auth-mode="signup">Create account</button></div>` : ""}
      ${isSignup ? `<div class="role-select" role="group" aria-label="Choose account type"><button data-role="restaurant" class="${authRole === "restaurant" ? "selected" : ""}"><span>♧</span><b>Restaurant</b><small>Share surplus food</small></button><button data-role="partner" class="${authRole === "partner" ? "selected" : ""}"><span>♡</span><b>Community partner</b><small>Find and collect food</small></button></div>` : ""}
      <form id="authForm" class="auth-form">
        ${isProfile ? `<label>Account email<input name="email" type="email" required value="${esc(profileDraft.email || "")}" placeholder="you@example.com" autocomplete="email"></label>` : ""}
        ${isSignup ? `<label>${authRole === "restaurant" ? "Restaurant or business name" : "Organization name"}<input name="name" required value="${esc(profileDraft.name || "")}" placeholder="${authRole === "restaurant" ? "e.g. Green Basket Market" : "e.g. Amara's Community Kitchen"}" autocomplete="organization"></label>` : ""}
        ${isSignup ? `<label>Phone number <span class="optional">Optional</span><input name="phone" type="tel" value="${esc(profileDraft.phone || "")}" autocomplete="tel" placeholder="+91 98765 43210"></label>` : `<p class="field-hint">You’ll enter your email and password on Cognito’s secure sign-in page.</p>`}
        ${isSignup ? `<div class="form-section-label"><span>Pickup area</span><i></i></div><div class="field-grid"><label>City<input name="city" required value="${esc(profileDraft.city || "")}" placeholder="Bengaluru" autocomplete="address-level2"></label><label>Postal code <span class="optional">Optional</span><input name="postalCode" value="${esc(profileDraft.postalCode || "")}" placeholder="560001" autocomplete="postal-code"></label></div>${authRole === "restaurant" ? `<label>Restaurant pickup address<input name="address" required value="${esc(profileDraft.address || "")}" placeholder="Street address, building, area" autocomplete="street-address"></label><div class="field-grid coordinate-grid"><label>Latitude <span class="optional">Map pin</span><input name="latitude" type="number" step="any" value="${esc(profileDraft.latitude || "")}" placeholder="12.9716"></label><label>Longitude <span class="optional">Map pin</span><input name="longitude" type="number" step="any" value="${esc(profileDraft.longitude || "")}" placeholder="77.5946"></label></div><button type="button" class="location-detect" data-geolocate>⌖ Use device location</button>` : ""}` : ""}
        <button class="primary-button auth-submit" type="submit">${isProfile ? "Save profile" : isSignup ? "Continue to secure sign-up" : "Continue to secure sign-in"}<span>→</span></button>
        <p class="auth-error" id="authError" aria-live="polite"></p>
      </form>
      ${isSignup ? `<div class="auth-terms">${isProfile ? "Your profile is stored securely with GoodTable." : "Cognito will securely collect your sign-in details."}</div>` : ""}
    </div><footer class="auth-footer">GoodTable · Community-powered food rescue <span>♡</span></footer></section>
  </main>`;
}

const navItems = (role) => role === "restaurant" ? [
  ["overview", "⌂", "Overview"], ["listings", "▤", "My listings"], ["pickups", "⇆", "Pickups"], ["impact", "↗", "Impact"], ["location", "⌖", "Location & profile"]
] : [["overview", "⌂", "Overview"], ["discover", "⌕", "Find food"], ["pickups", "⇆", "My pickups"], ["impact", "↗", "Impact"], ["location", "⌖", "Organization"]];

function activePage() { const path = location.hash.replace(/^#\/?/, "").split("/")[0]; return path || "overview"; }

function renderShell(pageContent) {
  const route = activePage();
  const nav = navItems(currentUser.role).map(([id, icon, label]) => `<a href="#/${id}" class="nav-link ${route === id ? "active" : ""}"><span class="nav-icon">${icon}</span><span>${label}</span>${id === "discover" ? `<span class="nav-count">${""}</span>` : ""}</a>`).join("");
  const accountMenu = (place) => `<div class="account-popover ${place}-popover" id="account-menu-${place}" role="menu" hidden><div class="account-menu-heading"><span class="account-menu-avatar">${esc(initials(currentUser.name))}</span><span><b>${esc(currentUser.name)}</b><small>${esc(currentUser.email)}</small></span></div><a class="account-menu-item" href="#/location" role="menuitem"><span>⚙</span> Account settings</a><button class="account-menu-item logout-item" data-signout role="menuitem"><span>↪</span> Log out</button></div>`;
  app.innerHTML = `<div class="app-shell"><aside class="sidebar" id="sidebar">${brand()}<div class="workspace-label">${currentUser.role === "restaurant" ? "FOOD BUSINESS" : "COMMUNITY NETWORK"}</div><nav class="main-nav">${nav}</nav><div class="sidebar-bottom"><div class="impact-mini"><div class="impact-mini-top"><span>✳</span><span>YOUR COMMUNITY</span></div><strong>Good food,<br>shared locally.</strong><p>Every listing makes a difference.</p></div><div class="account-menu-wrap side-account"><button class="profile-button" data-account-toggle="side" aria-expanded="false" aria-controls="account-menu-side"><span class="avatar">${esc(initials(currentUser.name))}</span><span class="profile-copy"><strong>${esc(currentUser.name)}</strong><small>${roleLabel(currentUser.role)}</small></span><span class="profile-more">⌄</span></button>${accountMenu("side")}</div><button class="help-link" data-help><span class="help-icon">?</span> Help center <span class="external-arrow">↗</span></button></div></aside>
  <main class="main-content"><header class="topbar"><button class="mobile-menu" data-menu aria-label="Open navigation">☰</button><div class="breadcrumbs"><span>GoodTable</span><span class="crumb-slash">/</span><strong>${esc(navItems(currentUser.role).find(([key]) => key === route)?.[2] || "Overview")}</strong></div><div class="topbar-actions"><div class="location-chip"><span>⌖</span>${esc(currentUser.city || "Set your city")}</div><div class="notification-wrap"><button class="notification-button" data-notification-toggle aria-label="Notifications" aria-expanded="false" aria-controls="notification-menu"><svg class="bell-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="notification-badge" data-notification-count hidden></span></button><div class="notification-popover" id="notification-menu" hidden><div class="notification-head"><span><b>Notifications</b><small>Pickup and listing activity</small></span><button class="mark-read-button" data-mark-notifications>Mark all read</button></div><div class="notification-list" data-notification-list><div class="notification-loading">Loading activity…</div></div><a class="notification-footer" href="#/pickups">View pickup activity <span>→</span></a></div></div><div class="account-menu-wrap top-account"><button class="top-user" data-account-toggle="top" aria-expanded="false" aria-controls="account-menu-top"><span class="top-avatar">${esc(initials(currentUser.name))}</span><span>${esc(currentUser.name)}</span><span class="chevron">⌄</span></button>${accountMenu("top")}</div></div></header><div class="page-wrap" id="pageContent">${pageContent}</div></main></div>`;
  refreshNotifications();
}

async function refreshNotifications() {
  if (!currentUser) return;
  try {
    notificationState = await api("/notifications");
    const badge = document.querySelector("[data-notification-count]");
    if (badge) { badge.textContent = notificationState.unreadCount > 9 ? "9+" : notificationState.unreadCount; badge.hidden = notificationState.unreadCount < 1; }
    const markButton = document.querySelector("[data-mark-notifications]");
    if (markButton) markButton.disabled = notificationState.unreadCount === 0;
    const list = document.querySelector("[data-notification-list]");
    if (list) list.innerHTML = notificationState.items.length ? notificationState.items.map((item) => `<a class="notification-item ${item.unread ? "unread" : ""}" href="${esc(item.href)}" data-notification-link><span class="notification-item-icon">${esc(item.icon)}</span><span class="notification-item-copy"><b>${esc(item.title)}</b><small>${esc(item.message)}</small><time>${relativeTime(item.at)}</time></span>${item.unread ? `<i class="unread-dot"></i>` : ""}</a>`).join("") : `<div class="notification-empty"><span>✳</span><b>You're all caught up</b><small>New pickup activity will show here.</small></div>`;
  } catch { /* Keep the inbox available if activity cannot be refreshed. */ }
}

function pageHeader(kicker, title, subtitle, action = "") { return `<div class="page-heading"><div><div class="section-kicker">${kicker}</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`; }
function statCard(label, value, unit, icon, tone, note) { return `<article class="stat-card"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon ${tone}">${icon}</span></div><div class="stat-number">${value} <small>${unit || ""}</small></div><div class="stat-foot"><span class="trend">${note || "✳"}</span><span>in your community</span></div></article>`; }
function foodEmoji(category, fallback = "🍽️") { return ({ Produce: "🥬", Bakery: "🥐", "Prepared meals": "🍱", Dairy: "🥛", Pantry: "🫙", Other: fallback })[category] || fallback; }
function statusBadge(status) { const labels = { available: "Available", claimed: "Claimed", completed: "Completed", cancelled: "Cancelled" }; return `<span class="status-badge ${esc(status)}">${labels[status] || esc(status)}</span>`; }
function listingCard(item, mode = "discover") {
  const claimed = item.status !== "available";
  const isSaved = mode === "discover" && savedListingIds().has(item.id);
  const address = item.address ? `<div class="food-location">⌖ ${esc(item.address)}, ${esc(item.city)}</div>` : `<div class="food-location">⌖ ${esc(item.city)} · Exact address after claim</div>`;
  return `<article class="food-card"><div class="food-card-art ${esc(item.category.toLowerCase().replace(/\s+/g, "-"))}"><span>${esc(item.image || foodEmoji(item.category))}</span>${statusBadge(item.status)}${mode === "discover" ? `<button class="save-listing-button ${isSaved ? "saved" : ""}" data-save-listing="${esc(item.id)}" aria-label="${isSaved ? "Remove saved listing" : "Save listing"}" title="${isSaved ? "Remove saved listing" : "Save for later"}">♡</button>` : ""}<span class="food-category">${esc(item.category)}</span></div><div class="food-card-body"><div class="food-title-row"><div><h3>${esc(item.name)}</h3><p class="food-business">${esc(item.restaurantName)}</p></div>${item.distanceKm != null ? `<span class="distance-pill">⌖ ${item.distanceKm} km</span>` : ""}</div><div class="food-meta-grid"><span><i>▧</i>${esc(item.quantity)}</span><span><i>♧</i>${item.servings || "—"} servings</span><span><i>◷</i>${prettyTime(item.pickupStart)} – ${prettyTime(item.pickupEnd)}</span><span><i>⌛</i>Best by ${esc(item.bestBefore || "Today")}</span></div>${address}<div class="food-note"><b>Allergens:</b> ${esc(item.allergens || "Not specified")}${item.notes ? ` · ${esc(item.notes)}` : ""}</div><div class="food-card-footer"><span>Listed ${dateLabel(item.createdAt)}</span>${mode === "discover" ? claimed ? statusBadge(item.status) : `<button class="secondary-button claim-button" data-claim="${esc(item.id)}">Request pickup <span>→</span></button>` : `<span>${statusBadge(item.status)}</span>`}</div></div></article>`;
}

async function renderOverview() {
  const isRestaurant = currentUser.role === "restaurant";
  const [impact, rows, pickupData] = await Promise.all([
    api("/impact"),
    api(isRestaurant ? "/my/listings" : `/listings?status=available&city=${encodeURIComponent(currentUser.city || "")}`),
    api("/my/pickups")
  ]);
  const items = rows.listings || [];
  const pickups = pickupData.pickups || [];
  const action = isRestaurant ? `<button class="primary-button" data-create-listing>＋ Share surplus food</button>` : `<a class="primary-button" href="#/discover">Find food nearby <span>→</span></a>`;
  let html = pageHeader(isRestaurant ? "FOOD BUSINESS" : "COMMUNITY PARTNER", `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${esc(currentUser.name.split(" ")[0])}`, isRestaurant ? "Share today's surplus and help good food reach the people who need it." : "Find surplus food near you and turn it into meaningful meals.", action);
  html += `<section class="stats-grid">${statCard(isRestaurant ? "ACTIVE LISTINGS" : "AVAILABLE NEARBY", impact.activeListings, "", isRestaurant ? "▤" : "⌕", "green", "↗")} ${statCard(isRestaurant ? "FOOD CLAIMED" : "MEALS RESCUED", impact.rescuedListings, "pickups", "♡", "peach", "✳")} ${statCard("MEALS IMPACTED", impact.meals, "meals", "♧", "blue", "↗")} ${statCard("FOOD DIVERTED", impact.foodKg, "units", "✳", "yellow", "↗")}</section>`;
  html += `<section class="overview-grid"><div class="surface-card overview-main"><div class="section-head"><div><div class="section-kicker">${isRestaurant ? "FROM YOUR KITCHEN" : "NEAR YOUR COMMUNITY"}</div><h2>${isRestaurant ? "Your active listings" : "Food available today"}</h2></div><a class="text-link" href="#/${isRestaurant ? "listings" : "discover"}">View all →</a></div>${items.length ? `<div class="compact-list">${items.slice(0, 3).map((item) => `<div class="compact-food"><span class="compact-emoji">${esc(item.image || foodEmoji(item.category))}</span><span class="compact-food-copy"><b>${esc(item.name)}</b><small>${isRestaurant ? "Your listing" : esc(item.restaurantName)} · ${esc(item.city)}</small></span>${statusBadge(item.status)}<span class="compact-quantity">${esc(item.quantity)}</span></div>`).join("")}</div>` : `<div class="empty-state"><span>🥕</span><b>${isRestaurant ? "Your first listing starts here" : "No food listings yet"}</b><p>${isRestaurant ? "Post food that's still fresh and ready to share." : "Check back soon or invite a local restaurant to join."}</p>${isRestaurant ? `<button class="secondary-button" data-create-listing>Create a listing →</button>` : ""}</div>`}</div><aside class="surface-card impact-aside"><div class="section-kicker">GOOD FOOD, BETTER FUTURE</div><div class="impact-illustration"><span class="impact-sun"></span><span class="impact-bowl">${isRestaurant ? "🥗" : "🍲"}</span><span class="impact-leaf leaf-left">✳</span><span class="impact-leaf leaf-right">✳</span></div><h3>Small acts add up.</h3><p>Every rescued meal supports a stronger, more sustainable neighborhood.</p><a class="text-link" href="#/impact">Explore your impact →</a></aside></section>`;
  html += `<section class="lower-grid"><div class="surface-card"><div class="section-head"><div><div class="section-kicker">NEXT UP</div><h2>${isRestaurant ? "Recent pickup activity" : "Your upcoming pickups"}</h2></div><a class="text-link" href="#/pickups">See pickups →</a></div>${pickups.length ? pickups.slice(0, 3).map((pickup) => pickupRow(pickup, isRestaurant)).join("") : `<div class="small-empty">${isRestaurant ? "No partner has claimed your food yet." : "You haven't requested a pickup yet."}</div>`}</div><div class="surface-card quick-card"><div class="section-kicker">QUICK TIP</div><div class="quick-quote">“A clear pickup window makes a good donation even better.”</div><p>${isRestaurant ? "Keep your pickup hours and food details current so partners can plan." : "Check allergens and best-before information before confirming a pickup."}</p><a class="text-link" href="#/location">${isRestaurant ? "Review business location" : "Update organization area"} →</a></div></section>`;
  renderShell(html);
}

function pickupRow(pickup, isRestaurant = false) {
  const item = pickup.listing || {};
  return `<div class="pickup-row"><span class="pickup-emoji">${esc(item.image || foodEmoji(item.category))}</span><span class="pickup-row-copy"><b>${esc(item.name || "Food pickup")}</b><small>${isRestaurant ? "Pickup partner" : esc(item.restaurantName || "Restaurant")} · ${esc(item.city || "")}</small></span><span class="pickup-date">${dateLabel(pickup.createdAt)}</span>${statusBadge(item.status || pickup.status)}</div>`;
}

async function renderDiscover() {
  const params = new URLSearchParams({ status: "available" });
  if (discoverFilters.q) params.set("q", discoverFilters.q);
  if (discoverFilters.category) params.set("category", discoverFilters.category);
  if (discoverFilters.city) params.set("city", discoverFilters.city);
  else if (currentUser.city) params.set("city", currentUser.city);
  const result = await api(`/listings?${params}`);
  const saved = savedListingIds();
  const listings = discoverFilters.savedOnly ? result.listings.filter((item) => saved.has(item.id)) : result.listings;
  const savedCount = saved.size;
  const cards = listings.length ? listings.map((item) => listingCard(item)).join("") : `<div class="empty-state discovery-empty"><span>⌕</span><b>No matching food found</b><p>Try clearing a filter or check another city.</p><button class="text-link" data-clear-filters>Clear filters</button></div>`;
  renderShell(`${pageHeader("DISCOVER SURPLUS", "Find good food nearby", "Browse fresh listings from restaurants in your community.", `<span class="count-pill">${listings.length} available</span>`)}
    <section class="discover-toolbar surface-card"><label class="search-input"><span>⌕</span><input id="discoverSearch" type="search" value="${esc(discoverFilters.q)}" placeholder="Search food, restaurant, or category"></label><label class="filter-select"><span>Category</span><select id="categoryFilter"><option value="">All categories</option>${["Produce", "Bakery", "Prepared meals", "Dairy", "Pantry", "Other"].map((cat) => `<option ${discoverFilters.category === cat ? "selected" : ""}>${cat}</option>`).join("")}</select></label><label class="filter-select city-select"><span>City</span><input id="cityFilter" value="${esc(discoverFilters.city || currentUser.city || "")}" placeholder="Any city"></label><button class="saved-filter ${discoverFilters.savedOnly ? "active" : ""}" data-toggle-saved>♡ Saved <b>${savedCount}</b></button><button class="clear-filter" data-clear-filters>Clear</button></section>
    <section class="discover-summary"><span>Showing <b>${listings.length} available ${listings.length === 1 ? "listing" : "listings"}</b> in ${esc(discoverFilters.city || currentUser.city || "all communities")}</span><span class="location-privacy">⌖ Exact pickup address is shared after a claim</span></section><section class="food-grid">${cards}</section>`);
}

async function renderListings() {
  const { listings } = await api("/my/listings");
  const available = listings.filter((item) => item.status === "available").length;
  const cards = listings.length ? listings.map((item) => listingCard(item, "manage")).join("") : `<div class="empty-state listing-empty"><span>🥕</span><b>Your first listing starts here</b><p>Let nearby community partners know what you have to share.</p><button class="primary-button" data-create-listing>＋ Create food listing</button></div>`;
  renderShell(`${pageHeader("YOUR FOOD BOARD", "My listings", "Manage surplus food, pickup windows, and listing status.", `<button class="primary-button" data-create-listing>＋ New listing</button>`)}<div class="listing-summary surface-card"><div><span class="summary-number">${listings.length}</span><span>Total listings</span></div><div><span class="summary-number green-number">${available}</span><span>Available now</span></div><div><span class="summary-number">${listings.filter((item) => item.status === "claimed").length}</span><span>Claimed</span></div><span class="summary-tip">Keep your availability up to date so partners know what they can collect.</span></div><section class="food-grid manage-grid">${cards}</section>`);
}

async function renderPickups() {
  const { pickups } = await api("/my/pickups");
  const isRestaurant = currentUser.role === "restaurant";
  const cards = pickups.length ? pickups.map((pickup) => `<article class="pickup-detail-card"><div class="pickup-detail-top"><span class="pickup-emoji large">${esc(pickup.listing?.image || foodEmoji(pickup.listing?.category))}</span><span>${statusBadge(pickup.listing?.status || pickup.status)}</span><span class="pickup-date">${dateLabel(pickup.createdAt)}</span></div><h3>${esc(pickup.listing?.name || "Food pickup")}</h3><p>${isRestaurant ? "Claimed by" : "Pickup from"} <b>${esc(isRestaurant ? "Community partner" : pickup.listing?.restaurantName || "Restaurant")}</b></p><div class="pickup-info-lines"><span>◷ ${prettyTime(pickup.listing?.pickupStart)} – ${prettyTime(pickup.listing?.pickupEnd)}</span><span>⌖ ${esc(pickup.listing?.address || "Address shared when claimed")}, ${esc(pickup.listing?.city || "")}</span><span>▧ ${esc(pickup.listing?.quantity || "Quantity details")}</span></div>${isRestaurant && pickup.listing?.status === "claimed" ? `<button class="secondary-button complete-button" data-status="completed" data-listing="${esc(pickup.listing.id)}">Mark pickup completed</button>` : ""}</article>`).join("") : `<div class="empty-state"><span>⇆</span><b>No pickups yet</b><p>${isRestaurant ? "When a community partner claims a listing, the pickup will appear here." : "Browse food in your community and request a pickup to get started."}</p>${!isRestaurant ? `<a class="primary-button" href="#/discover">Find food nearby →</a>` : ""}</div>`;
  renderShell(`${pageHeader(isRestaurant ? "PARTNER ACTIVITY" : "YOUR PICKUP SCHEDULE", isRestaurant ? "Pickups & handoffs" : "My pickups", isRestaurant ? "Stay up to date with the people collecting your donations." : "Your confirmed food pickups, all in one place.", "")}<section class="pickup-grid">${cards}</section>`);
}

async function renderImpact() {
  const impact = await api("/impact");
  const isRestaurant = currentUser.role === "restaurant";
  const { listings } = await api(isRestaurant ? "/my/listings" : "/listings");
  const categories = ["Produce", "Bakery", "Prepared meals", "Dairy", "Pantry", "Other"].map((category) => ({ category, count: listings.filter((item) => item.category === category && ["claimed", "completed"].includes(item.status)).length }));
  const max = Math.max(1, ...categories.map((entry) => entry.count));
  renderShell(`${pageHeader("COMMUNITY GOOD", "Your impact", "Every pickup is a meal rescued and a connection made.", "")}<section class="impact-hero surface-card"><div><div class="section-kicker">${isRestaurant ? "YOUR DONATIONS" : "YOUR PICKUPS"}</div><h2>Good food finds<br>a good home.</h2><p>Thank you for being part of a more thoughtful food system.</p></div><div class="impact-big-heart">♡</div></section><section class="stats-grid impact-stats">${statCard("LISTINGS RESCUED", impact.rescuedListings, "", "♡", "green", "✳")} ${statCard("MEALS SUPPORTED", impact.meals, "meals", "♧", "peach", "↗")} ${statCard("FOOD DIVERTED", impact.foodKg, "units", "✳", "blue", "↗")} ${statCard("ACTIVE LISTINGS", impact.activeListings, "", "▤", "yellow", "↗")}</section><section class="surface-card category-impact"><div class="section-head"><div><div class="section-kicker">WHERE THE GOOD GOES</div><h2>Rescued by food type</h2></div><span class="muted-small">Based on ${isRestaurant ? "your listings" : "your community"}</span></div>${categories.map((entry) => `<div class="bar-row"><span>${esc(entry.category)}</span><div class="bar-track"><i style="width:${Math.round(entry.count / max * 100)}%"></i></div><b>${entry.count}</b></div>`).join("")}</section>`);
}

async function renderLocation() {
  renderShell(`<div class="page-heading"><div><div class="section-kicker">${currentUser.role === "restaurant" ? "BUSINESS SETTINGS" : "ORGANIZATION SETTINGS"}</div><h1>${currentUser.role === "restaurant" ? "Location & profile" : "Organization profile"}</h1><p>Keep your public profile and community area up to date.</p></div></div><section class="profile-layout"><form id="profileForm" class="surface-card profile-form"><div class="section-head"><div><div class="section-kicker">PUBLIC PROFILE</div><h2>Basic information</h2></div><span class="profile-avatar">${esc(initials(currentUser.name))}</span></div><div class="profile-fields"><label>${currentUser.role === "restaurant" ? "Business name" : "Organization name"}<input name="name" required value="${esc(currentUser.name)}"></label><label>Contact phone<input name="phone" type="tel" value="${esc(currentUser.phone || "")}" placeholder="+91 98765 43210"></label><label>Email address<input value="${esc(currentUser.email)}" disabled></label><div class="field-grid"><label>City<input name="city" required value="${esc(currentUser.city || "")}"></label><label>Postal code<input name="postalCode" value="${esc(currentUser.postalCode || "")}"></label></div>${currentUser.role === "restaurant" ? `<label>Pickup address<input name="address" required value="${esc(currentUser.address || "")}" placeholder="Street address, building, area"></label><div class="form-section-label"><span>Map pin</span><i></i></div><p class="field-hint">Coordinates let community partners sort food by distance. You can enter them manually or use your device location.</p><div class="field-grid coordinate-grid"><label>Latitude<input name="latitude" type="number" step="any" value="${currentUser.latitude ?? ""}" placeholder="12.9716"></label><label>Longitude<input name="longitude" type="number" step="any" value="${currentUser.longitude ?? ""}" placeholder="77.5946"></label></div><button type="button" class="location-detect" data-geolocate>⌖ Use device location</button><div class="location-preview"><span class="preview-pin">⌖</span><div><b>${currentUser.latitude != null && currentUser.longitude != null ? `${Number(currentUser.latitude).toFixed(4)}, ${Number(currentUser.longitude).toFixed(4)}` : "No map pin set"}</b><small>${currentUser.latitude != null ? "Your listing location is set" : "Add coordinates to enable distance sorting"}</small></div><a href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">Open map ↗</a></div>` : `<div class="partner-area-note"><span>⌖</span><div><b>Your pickup search area</b><p>Listings in ${esc(currentUser.city || "your city")} appear first. Add coordinates to sort by distance.</p></div></div><div class="field-grid coordinate-grid"><label>Latitude<input name="latitude" type="number" step="any" value="${currentUser.latitude ?? ""}" placeholder="12.9716"></label><label>Longitude<input name="longitude" type="number" step="any" value="${currentUser.longitude ?? ""}" placeholder="77.5946"></label></div>`}<div class="profile-actions"><span class="auth-error" id="profileError"></span><button class="primary-button" type="submit">Save profile <span>→</span></button></div></div></form><aside class="surface-card location-side"><div class="location-side-art"><span>⌖</span><div class="map-lines"></div></div><div class="section-kicker">WHY LOCATION MATTERS</div><h3>Good food, closer to home.</h3><p>We use your city and optional map coordinates to help partners find listings nearby. Your precise address is only shown to the partner who claims your food.</p><div class="privacy-note"><span>◈</span> Your address stays private until pickup is confirmed.</div></aside></section>`);
}

function modalListing() {
  return `<div class="modal-backdrop open" id="listingModal"><section class="modal listing-modal" role="dialog" aria-modal="true" aria-labelledby="listingModalTitle"><button class="modal-close" data-close-modal aria-label="Close">×</button><div class="modal-icon">♡</div><div class="section-kicker">HELP GOOD FOOD FIND A HOME</div><h2 id="listingModalTitle">Share surplus food</h2><p class="modal-intro">Tell nearby partners what is available and when they can collect it.</p><form id="listingForm"><label>Food name<input name="name" required maxlength="120" placeholder="e.g. Fresh vegetable boxes"></label><div class="field-grid"><label>Category<select name="category" required><option>Produce</option><option>Bakery</option><option>Prepared meals</option><option>Dairy</option><option>Pantry</option><option>Other</option></select></label><label>Quantity<input name="quantity" required placeholder="e.g. 12 boxes"></label></div><div class="field-grid"><label>Approx. servings<input name="servings" type="number" min="1" placeholder="e.g. 24"></label><label>Best before<input name="bestBefore" required placeholder="Today, 27 Oct"></label></div><div class="field-grid"><label>Pickup starts<input name="pickupStart" type="time" required></label><label>Pickup ends<input name="pickupEnd" type="time" required></label></div><label>Allergens<input name="allergens" placeholder="e.g. Wheat, dairy, nuts — or None declared"></label><label>Pickup notes<textarea name="notes" rows="2" placeholder="Storage instructions or what to bring"></textarea></label><button class="primary-button modal-submit" type="submit">Publish listing <span>→</span></button><p class="auth-error" id="listingError"></p></form><div class="modal-note">Please share only food that is safe, properly stored, and accurately described.</div></section></div>`;
}

async function renderRoute() {
  if (!currentUser) return renderAuth();
  const page = activePage();
  try {
    if (page === "overview") return await renderOverview();
    if (page === "discover" && currentUser.role === "partner") return await renderDiscover();
    if (page === "listings" && currentUser.role === "restaurant") return await renderListings();
    if (page === "pickups") return await renderPickups();
    if (page === "impact") return await renderImpact();
    if (page === "location") return await renderLocation();
    location.hash = "#/overview";
  } catch (error) {
    renderShell(`${pageHeader("SOMETHING WENT WRONG", "We couldn't load this page", esc(error.message), `<button class="secondary-button" data-retry>Try again</button>`)}<div class="surface-card error-surface">Your account is still signed in. Try again in a moment.</div>`);
  }
}

function setAuthError(message) { const node = document.querySelector("#authError"); if (node) node.textContent = message; }

document.addEventListener("click", async (event) => {
  const notificationToggle = event.target.closest("[data-notification-toggle]");
  if (notificationToggle) {
    const menu = document.querySelector("#notification-menu");
    const shouldOpen = menu?.hidden;
    document.querySelectorAll(".account-popover").forEach((popover) => { popover.hidden = true; });
    document.querySelectorAll("[data-account-toggle]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    if (menu) menu.hidden = !shouldOpen;
    notificationToggle.setAttribute("aria-expanded", String(Boolean(shouldOpen)));
    if (shouldOpen) await refreshNotifications();
    return;
  }
  if (event.target.closest("[data-mark-notifications]")) {
    try { await api("/notifications/read", { method: "POST", body: "{}" }); await refreshNotifications(); toast("Notifications marked as read."); }
    catch (error) { toast(error.message, "error"); }
    return;
  }
  if (event.target.closest("[data-notification-link]")) {
    try { await api("/notifications/read", { method: "POST", body: "{}" }); }
    catch { /* The pickup page remains available if read state cannot be saved. */ }
    const menu = document.querySelector("#notification-menu"); if (menu) menu.hidden = true;
    document.querySelector("[data-notification-toggle]")?.setAttribute("aria-expanded", "false");
    return;
  }
  if (!event.target.closest(".notification-wrap")) {
    const menu = document.querySelector("#notification-menu"); if (menu) menu.hidden = true;
    document.querySelector("[data-notification-toggle]")?.setAttribute("aria-expanded", "false");
  }
  const accountToggle = event.target.closest("[data-account-toggle]");
  if (accountToggle) {
    const menu = document.querySelector(`#account-menu-${accountToggle.dataset.accountToggle}`);
    const shouldOpen = menu?.hidden;
    document.querySelectorAll(".account-popover").forEach((popover) => { popover.hidden = true; });
    document.querySelectorAll("[data-account-toggle]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    if (menu && shouldOpen) { menu.hidden = false; accountToggle.setAttribute("aria-expanded", "true"); }
    return;
  }
  if (!event.target.closest(".account-menu-wrap")) {
    document.querySelectorAll(".account-popover").forEach((popover) => { popover.hidden = true; });
    document.querySelectorAll("[data-account-toggle]").forEach((button) => button.setAttribute("aria-expanded", "false"));
  }
  const mode = event.target.closest("[data-auth-mode]");
  if (mode) { authMode = mode.dataset.authMode; renderAuth(); return; }
  const role = event.target.closest("[data-role]");
  if (role) { authRole = role.dataset.role; renderAuth(); return; }
  const demo = event.target.closest("[data-demo]");
  if (demo) {
    const email = demo.dataset.demo === "restaurant" ? "restaurant@goodtable.demo" : "partner@goodtable.demo";
    try { const result = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password: "GoodTableDemo!26" }) }); currentUser = result.user; location.hash = "#/overview"; await renderRoute(); }
    catch (error) { setAuthError(error.message); }
    return;
  }
  if (event.target.closest("[data-signout]")) { await signOutFromCognito(); return; }
  if (event.target.closest("[data-create-listing]")) { document.body.insertAdjacentHTML("beforeend", modalListing()); return; }
  if (event.target.closest("[data-close-modal]") || event.target.id === "listingModal") { document.querySelector("#listingModal")?.remove(); return; }
  const claim = event.target.closest("[data-claim]");
  const saveButton = event.target.closest("[data-save-listing]");
  if (saveButton) {
    const isSaved = saveListing(saveButton.dataset.saveListing);
    toast(isSaved ? "Saved for later." : "Removed from saved listings.");
    await renderDiscover();
    return;
  }
  if (event.target.closest("[data-toggle-saved]")) {
    discoverFilters.savedOnly = !discoverFilters.savedOnly;
    await renderDiscover();
    return;
  }
  if (claim) {
    claim.disabled = true;
    try { await api(`/listings/${claim.dataset.claim}/claim`, { method: "POST", body: "{}" }); toast("Pickup confirmed. The restaurant address is now available in your pickups."); await renderRoute(); }
    catch (error) { toast(error.message, "error"); await renderRoute(); }
    return;
  }
  const statusButton = event.target.closest("[data-status]");
  if (statusButton) {
    try { await api(`/listings/${statusButton.dataset.listing}/status`, { method: "PATCH", body: JSON.stringify({ status: statusButton.dataset.status }) }); toast("Pickup marked as completed."); await renderRoute(); }
    catch (error) { toast(error.message, "error"); }
    return;
  }
  if (event.target.closest("[data-clear-filters]")) { discoverFilters = { q: "", category: "", city: "", savedOnly: false }; await renderDiscover(); return; }
  if (event.target.closest("[data-geolocate]")) {
    if (!navigator.geolocation) return toast("This browser does not support location detection.", "error");
    navigator.geolocation.getCurrentPosition((position) => {
      const lat = document.querySelector('[name="latitude"]'); const lon = document.querySelector('[name="longitude"]');
      if (lat) lat.value = position.coords.latitude.toFixed(6); if (lon) lon.value = position.coords.longitude.toFixed(6);
      toast("Location added. Save your profile to update your map pin.");
    }, () => toast("Location was not available. You can enter coordinates manually.", "error"), { enableHighAccuracy: false, timeout: 10000 });
    return;
  }
  if (event.target.closest("[data-menu]")) { document.querySelector("#sidebar")?.classList.toggle("open"); return; }
  if (event.target.closest("[data-help]")) { toast("Need help? Contact support@goodtable.community"); return; }
  if (event.target.closest("[data-retry]")) { await renderRoute(); }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "authForm") {
    event.preventDefault();
    const form = new FormData(event.target);
    const body = Object.fromEntries(form.entries());
    const button = event.target.querySelector("button[type=submit]"); button.disabled = true; setAuthError("");
    try {
      if (authMode === "login") { await beginSignIn(); return; }
      if (authMode === "signup") {
        profileDraft = { ...body, role: authRole };
        sessionStorage.setItem("goodtable:profile-draft", JSON.stringify(profileDraft));
        await beginSignIn();
        return;
      }
      body.email = (await auth.getUser())?.profile?.email || body.email || "";
      const result = await api("/me", { method: "POST", body: JSON.stringify({ ...body, role: authRole }) });
      currentUser = result.user;
      sessionStorage.removeItem("goodtable:profile-draft");
      location.hash = "#/overview";
      await renderRoute();
    }
    catch (error) { setAuthError(error.message); button.disabled = false; }
  }
  if (event.target.id === "listingForm") {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.target).entries());
    try { await api("/listings", { method: "POST", body: JSON.stringify(form) }); document.querySelector("#listingModal")?.remove(); toast("Your food listing is now live."); location.hash = "#/listings"; await renderRoute(); }
    catch (error) { const node = document.querySelector("#listingError"); if (node) node.textContent = error.message; }
  }
  if (event.target.id === "profileForm") {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target).entries());
    try { const result = await api("/me", { method: "PATCH", body: JSON.stringify(data) }); currentUser = result.user; toast("Your profile and location have been saved."); await renderRoute(); }
    catch (error) { const node = document.querySelector("#profileError"); if (node) node.textContent = error.message; }
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.id === "categoryFilter") { discoverFilters.category = event.target.value; await renderDiscover(); }
  if (event.target.id === "cityFilter") { discoverFilters.city = event.target.value.trim(); await renderDiscover(); }
});
document.addEventListener("input", (event) => {
  if (event.target.id !== "discoverSearch") return;
  discoverFilters.q = event.target.value;
  clearTimeout(window.goodtableSearchTimer);
  window.goodtableSearchTimer = setTimeout(() => renderDiscover(), 180);
});
window.addEventListener("hashchange", () => { document.querySelector("#sidebar")?.classList.remove("open"); renderRoute(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.querySelectorAll(".account-popover").forEach((popover) => { popover.hidden = true; });
    document.querySelectorAll("[data-account-toggle]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    const notificationMenu = document.querySelector("#notification-menu"); if (notificationMenu) notificationMenu.hidden = true;
    document.querySelector("[data-notification-toggle]")?.setAttribute("aria-expanded", "false");
  }
});

async function startGoodTable() {
try {
  const cognitoUser = await finishAuthRedirect();
  if (cognitoUser) {
    try {
      const result = await api("/me");
      currentUser = result.user;
    } catch (error) {
      if (error.status !== 404 || !error.payload?.profileRequired) throw error;
      try { profileDraft = JSON.parse(sessionStorage.getItem("goodtable:profile-draft") || "{}"); } catch { profileDraft = {}; }
      profileDraft.email ||= error.payload.email || cognitoUser.profile?.email || "";
      authRole = profileDraft.role || "partner";
      authMode = "profile";
      renderAuth();
      throw Object.assign(new Error("Complete your GoodTable profile to continue."), { profileFormRequired: true });
    }
    if (!location.hash) location.hash = "#/overview";
    await renderRoute();
  } else {
    authMode = "login";
    renderAuth();
  }
} catch (error) {
  if (!error.profileFormRequired) {
    authMode = "login";
    renderAuth();
    if (error.message) setAuthError(error.message);
  }
}
}

startGoodTable();
