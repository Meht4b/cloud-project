import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const T = { profiles: process.env.PROFILES_TABLE || "GoodTableProfiles", listings: process.env.LISTINGS_TABLE || "GoodTableListings", pickups: process.env.PICKUPS_TABLE || "GoodTablePickups" };
const now = () => new Date().toISOString();
const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const json = (statusCode, data) => ({ statusCode, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(data) });
const bad = (statusCode, error) => json(statusCode, { error });
const body = (event) => { try { return JSON.parse(event.body || "{}"); } catch { throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 }); } };
function coords(lat, lon) {
  const blank = (v) => v === "" || v == null;
  if (blank(lat) && blank(lon)) return { latitude: null, longitude: null };
  const latitude = Number(lat), longitude = Number(lon);
  if (blank(lat) || blank(lon) || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw Object.assign(new Error("Enter both valid map coordinates, or leave both blank."), { status: 400 });
  return { latitude, longitude };
}
const profileFor = async (userId) => (await ddb.send(new GetCommand({ TableName: T.profiles, Key: { userId } }))).Item;
function safeListing(item, user) { const { address, ...rest } = item; return { ...rest, address: user && (user.role === "restaurant" && user.userId === item.restaurantId || item.claimedBy === user.userId) ? address : null }; }
function distance(a, b) { if (typeof a.latitude !== "number" || typeof a.longitude !== "number" || typeof b.latitude !== "number" || typeof b.longitude !== "number") return null; const r=x=>x*Math.PI/180, dlat=r(b.latitude-a.latitude), dlon=r(b.longitude-a.longitude), h=Math.sin(dlat/2)**2+Math.cos(r(a.latitude))*Math.cos(r(b.latitude))*Math.sin(dlon/2)**2; return Math.round(6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))*10)/10; }
async function byIndex(table, index, key, value) { const res = await ddb.send(new QueryCommand({ TableName: table, IndexName: index, KeyConditionExpression: "#k = :v", ExpressionAttributeNames: { "#k": key }, ExpressionAttributeValues: { ":v": value }, ScanIndexForward: false })); return res.Items || []; }
async function allListings() { const res = await ddb.send(new ScanCommand({ TableName: T.listings })); return res.Items || []; }

export const handler = async (event) => {
  try {
    const method = event.requestContext?.http?.method || event.httpMethod || "GET";
    const path = event.rawPath || event.path || "/";
    // Browser CORS preflight requests do not include a Cognito bearer token.
    // API Gateway should route OPTIONS separately without the JWT authorizer.
    if (method === "OPTIONS") return { statusCode: 204, headers: { "access-control-allow-origin": "https://meht4b.github.io", "access-control-allow-methods": "GET,POST,OPTIONS,PATCH", "access-control-allow-headers": "authorization,content-type", "access-control-max-age": "600" }, body: "" };
    const q = event.queryStringParameters || {};
    const claims = event.requestContext?.authorizer?.jwt?.claims || {};
    const userId = claims.sub;
    let user = userId ? await profileFor(userId) : null;
    if (method === "GET" && path === "/api/health") return json(200, { status: "ok" });
    if (method === "GET" && path === "/api/me") return user ? json(200, { user }) : json(404, { profileRequired: true, email: claims.email || "", name: claims.name || "" });
    if (method === "POST" && path === "/api/me") {
      if (!userId) return bad(401, "Sign in to continue.");
      if (user) return json(200, { user });
      const input = body(event), role = input.role;
      if (!["restaurant", "partner"].includes(role)) return bad(400, "Choose Restaurant or Community partner.");
      const pin = coords(input.latitude, input.longitude);
      const profile = { userId, email: clean(claims.email || input.email,254).toLowerCase(), role, name: clean(input.name,100), phone: clean(input.phone,30), city: clean(input.city,100), address: clean(input.address,200), postalCode: clean(input.postalCode,20), ...pin, createdAt: now() };
      if (!profile.email || !profile.name || !profile.city || (role === "restaurant" && !profile.address)) return bad(400, role === "restaurant" ? "Business name, city, and pickup address are required." : "Organization name and city are required.");
      await ddb.send(new PutCommand({ TableName: T.profiles, Item: profile, ConditionExpression: "attribute_not_exists(userId)" })); return json(201, { user: profile });
    }
    if (!userId || !user) return bad(401, "Complete your GoodTable profile or sign in again.");
    if (method === "PATCH" && path === "/api/me") {
      const input = body(event), updates = {};
      for (const k of ["name","phone","city","address","postalCode"]) if (input[k] !== undefined) updates[k] = clean(input[k], k === "address" ? 200 : 100);
      if (input.latitude !== undefined || input.longitude !== undefined) Object.assign(updates, coords(input.latitude ?? user.latitude, input.longitude ?? user.longitude));
      const names={}, values={}; let sets=[]; for (const [k,v] of Object.entries(updates)) { names[`#${k}`]=k; values[`:${k}`]=v; sets.push(`#${k} = :${k}`); }
      if (sets.length) await ddb.send(new UpdateCommand({ TableName:T.profiles,Key:{userId},UpdateExpression:`SET ${sets.join(", ")}`,ExpressionAttributeNames:names,ExpressionAttributeValues:values }));
      user={...user,...updates}; return json(200,{user});
    }
    if (method === "GET" && path === "/api/listings") {
      let rows;
      if (q.city && q.status) rows = await byIndex(T.listings,"CityStatusIndex","cityStatus",`${clean(q.city,100).toLowerCase()}#${clean(q.status,30).toLowerCase()}`);
      else if (q.city) { const [a,b]=await Promise.all([byIndex(T.listings,"CityStatusIndex","cityStatus",`${clean(q.city,100).toLowerCase()}#available`), ...(q.status==="claimed"?[byIndex(T.listings,"CityStatusIndex","cityStatus",`${clean(q.city,100).toLowerCase()}#claimed`)]:[])]); rows=a.flat(); if(b) rows=rows.concat(b); }
      else rows = await allListings();
      const query=clean(q.q,100).toLowerCase(), cat=clean(q.category,40), city=clean(q.city,100).toLowerCase(), status=clean(q.status,30);
      rows=rows.filter(x=>(!status||x.status===status)&&(!cat||x.category===cat)&&(!city||String(x.city).toLowerCase()===city)&&(!query||`${x.name} ${x.restaurantName} ${x.category} ${x.city}`.toLowerCase().includes(query)));
      if(user.role==="partner") rows=rows.map(x=>({...x,distanceKm:distance(user,x)})).sort((a,b)=>(a.distanceKm??Infinity)-(b.distanceKm??Infinity));
      return json(200,{listings:rows.map(x=>safeListing(x,user))});
    }
    if (method === "POST" && path === "/api/listings") {
      if(user.role!=="restaurant") return bad(403,"This action is for restaurant accounts.");
      const x=body(event), name=clean(x.name,120), category=clean(x.category,40), quantity=clean(x.quantity,80);
      if(!name||!quantity||!["Produce","Bakery","Prepared meals","Dairy","Pantry","Other"].includes(category)) return bad(400,"Food name, category, and quantity are required.");
      const item={listingId:randomUUID().replaceAll("-",""),restaurantId:userId,restaurantName:user.name,city:user.city.toLowerCase(),address:user.address,latitude:user.latitude,longitude:user.longitude,name,category,quantity,servings:Number(x.servings)||0,pickupStart:clean(x.pickupStart,5),pickupEnd:clean(x.pickupEnd,5),bestBefore:clean(x.bestBefore,30),allergens:clean(x.allergens,180),notes:clean(x.notes,500),image:clean(x.image,4)||"🍽️",status:"available",cityStatus:`${user.city.toLowerCase()}#available`,createdAt:now(),updatedAt:now(),claimedBy:null,claimedAt:null};
      await ddb.send(new PutCommand({TableName:T.listings,Item:item})); return json(201,{listing:safeListing(item,user)});
    }
    if (method === "GET" && path === "/api/my/listings") { if(user.role!=="restaurant") return bad(403,"This action is for restaurant accounts."); const rows=await byIndex(T.listings,"RestaurantIndex","restaurantId",userId); return json(200,{listings:rows.map(x=>safeListing(x,user))}); }
    const claim=path.match(/^\/api\/listings\/([^/]+)\/claim$/);
    if(method==="POST"&&claim){ if(user.role!=="partner")return bad(403,"This action is for community partner accounts."); const listingId=claim[1], found=await ddb.send(new GetCommand({TableName:T.listings,Key:{listingId}})); if(!found.Item)return bad(404,"Listing not found."); const item=found.Item,pickupId=randomUUID().replaceAll("-",""); const pickup={pickupId,listingId,partnerId:userId,restaurantId:item.restaurantId,status:"confirmed",createdAt:now()}; try { await ddb.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:T.listings,Key:{listingId},UpdateExpression:"SET #s = :claimed, claimedBy = :partner, claimedAt = :at, updatedAt = :at, cityStatus = :cityStatus",ConditionExpression:"#s = :available",ExpressionAttributeNames:{"#s":"status"},ExpressionAttributeValues:{":claimed":"claimed",":available":"available",":partner":userId,":at":pickup.createdAt,":cityStatus":`${String(item.city).toLowerCase()}#claimed`}}},{Put:{TableName:T.pickups,Item:pickup,ConditionExpression:"attribute_not_exists(pickupId)"}}]})); } catch(e){if(e.name==="TransactionCanceledException")return bad(409,"This food has already been claimed.");throw e;} return json(201,{pickup:{...pickup,listing:safeListing({...item,status:"claimed",claimedBy:userId,address:item.address},user)}}); }
    if(method==="GET"&&path==="/api/my/pickups"){const rows=user.role==="partner"?await byIndex(T.pickups,"PartnerIndex","partnerId",userId):await byIndex(T.pickups,"RestaurantIndex","restaurantId",userId);const pickups=await Promise.all(rows.map(async p=>{const l=await ddb.send(new GetCommand({TableName:T.listings,Key:{listingId:p.listingId}}));return {...p,listing:l.Item?safeListing(l.Item,user):null};}));return json(200,{pickups});}
    if(method==="GET"&&path==="/api/notifications"){const rows=user.role==="partner"?await byIndex(T.pickups,"PartnerIndex","partnerId",userId):await byIndex(T.pickups,"RestaurantIndex","restaurantId",userId);const items=[];for(const p of rows.slice(0,30)){const r=await ddb.send(new GetCommand({TableName:T.listings,Key:{listingId:p.listingId}}));const l=r.Item;if(!l)continue;const roleItems=user.role==="restaurant"?[{id:`${p.pickupId}-claimed`,title:"Food claimed",message:`${l.name} was claimed by a community partner.`,at:p.createdAt,icon:"♡",href:"#/pickups"}]:[{id:`${p.pickupId}-confirmed`,title:"Pickup confirmed",message:`Your pickup for ${l.name} is confirmed.`,at:p.createdAt,icon:"⌖",href:"#/pickups"}];if(l.status==="completed")roleItems.push({id:`${p.pickupId}-completed`,title:user.role==="restaurant"?"Pickup completed":"Food collected",message:`${l.name} has been marked as collected.`,at:l.updatedAt||p.createdAt,icon:"✓",href:"#/pickups"});items.push(...roleItems);}items.sort((a,b)=>new Date(b.at)-new Date(a.at));const readAt=user.notificationsReadAt?Date.parse(user.notificationsReadAt):0, visible=items.slice(0,12).map(x=>({...x,unread:Date.parse(x.at)>readAt}));return json(200,{unreadCount:visible.filter(x=>x.unread).length,readAt:user.notificationsReadAt||null,items:visible});}
    if(method==="POST"&&path==="/api/notifications/read"){const readAt=now();await ddb.send(new UpdateCommand({TableName:T.profiles,Key:{userId},UpdateExpression:"SET notificationsReadAt = :t",ExpressionAttributeValues:{":t":readAt}}));return json(200,{ok:true,readAt});}
    const statusMatch=path.match(/^\/api\/listings\/([^/]+)\/status$/);if(method==="PATCH"&&statusMatch){if(user.role!=="restaurant")return bad(403,"This action is for restaurant accounts.");const listingId=statusMatch[1],item=(await ddb.send(new GetCommand({TableName:T.listings,Key:{listingId}}))).Item;if(!item)return bad(404,"Listing not found.");if(item.restaurantId!==userId)return bad(403,"You can only update your own listings.");const {status}=body(event);if(!["available","completed","cancelled"].includes(status))return bad(400,"Choose a valid listing status.");const cityStatus=`${String(item.city).toLowerCase()}#${status}`;const updatedAt=now();await ddb.send(new UpdateCommand({TableName:T.listings,Key:{listingId},UpdateExpression:"SET #s = :s, updatedAt = :at, cityStatus = :cs",ExpressionAttributeNames:{"#s":"status"},ExpressionAttributeValues:{":s":status,":at":updatedAt,":cs":cityStatus}}));return json(200,{listing:{...item,status,cityStatus,updatedAt}});}
    if(method==="GET"&&path==="/api/impact"){const rows=user.role==="restaurant"?await byIndex(T.listings,"RestaurantIndex","restaurantId",userId):await allListings();const mine=user.role==="restaurant"?rows:rows.filter(x=>x.claimedBy===userId);const nearby=user.role==="partner"?rows.filter(x=>x.status==="available"&&String(x.city).toLowerCase()===String(user.city).toLowerCase()):rows.filter(x=>x.status==="available");const rescued=mine.filter(x=>["claimed","completed"].includes(x.status));return json(200,{activeListings:nearby.length,rescuedListings:rescued.length,meals:rescued.reduce((s,x)=>s+(x.servings||0),0),foodKg:rescued.reduce((s,x)=>s+(Number.parseInt(x.quantity,10)||0),0)});}
    return bad(404,"That page or API route does not exist.");
  } catch (error) { console.error(error); return bad(error.status||500,error.status?error.message:"Something went wrong. Please try again."); }
};
