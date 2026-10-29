import { UserManager } from "oidc-client-ts";

const issuer = import.meta.env.VITE_COGNITO_ISSUER || "https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_s9wOWT4w8";
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID || "6h410d9fvom8m7bstn0snk008o";
const domain = import.meta.env.VITE_COGNITO_DOMAIN || "https://ap-south-1s9wowt4w8.auth.ap-south-1.amazoncognito.com";
const redirectUri = window.location.origin;

export const auth = new UserManager({
  authority: issuer,
  client_id: clientId,
  redirect_uri: redirectUri,
  post_logout_redirect_uri: redirectUri,
  response_type: "code",
  scope: "phone openid email",
  automaticSilentRenew: true
});

export async function finishAuthRedirect() {
  if (new URLSearchParams(window.location.search).has("code")) {
    await auth.signinRedirectCallback();
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
  }
  return auth.getUser();
}

export function beginSignIn() { return auth.signinRedirect(); }

export async function signOutFromCognito() {
  await auth.removeUser();
  const url = new URL(`${domain}/logout`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("logout_uri", redirectUri);
  window.location.assign(url.toString());
}
