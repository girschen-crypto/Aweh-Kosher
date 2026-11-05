/* TradeDesk VALR read-only owner access: WebAuthn passkeys first,
 * owner password fallback only. All biometric scanning stays on device.
 * Never persist a password, VALR API key, or secret in browser storage.
 */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const status = msg => { $("valrConnectionStatus").textContent = msg; };
const passStatus = msg => { $("valrPasskeyStatus").textContent = msg; };
const clear = () => $("valrBalanceList").replaceChildren();
const passkeyURL = "/.netlify/functions/tradedesk-passkeys";
let passkeyEnrolled = false;

function fromB64(value) {
  const b64 = value.replace(/-/g,"+").replace(/_/g,"/");
  const text = atob(b64 + "=".repeat((4-b64.length%4)%4));
  return Uint8Array.from(text, x=>x.charCodeAt(0));
}
function toB64(value) {
  const array = new Uint8Array(value);
  let text="";
  for(const byte of array) text+=String.fromCharCode(byte);
  return btoa(text).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function postPasskey(action, extra = {}, ownerPassword = "") {
  const response = await fetch(passkeyURL,{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{
      "Content-Type":"application/json",
      ...(ownerPassword ? {"Authorization":"Bearer "+ownerPassword} : {}),
    },
    body:JSON.stringify({action,...extra}),
    signal:AbortSignal.timeout(25000),
  });
  const data=await response.json();
  if (!response.ok || !data.ok) throw Error(data.error || "PASSKEY_UNAVAILABLE");
  return data;
}
function serialiseCredential(credential) {
  if(typeof credential.toJSON === "function") return credential.toJSON();
  const response=credential.response;
  if(credential.type==="public-key" && response.attestationObject) {
    return {
      id:credential.id,rawId:toB64(credential.rawId),type:credential.type,
      response:{
        attestationObject:toB64(response.attestationObject),
        clientDataJSON:toB64(response.clientDataJSON),
        transports:response.getTransports?.() || [],
      },
      clientExtensionResults:credential.getClientExtensionResults(),
      authenticatorAttachment:credential.authenticatorAttachment,
    };
  }
  return {
    id:credential.id,rawId:toB64(credential.rawId),type:credential.type,
    response:{
      authenticatorData:toB64(response.authenticatorData),
      clientDataJSON:toB64(response.clientDataJSON),
      signature:toB64(response.signature),
      userHandle:response.userHandle?toB64(response.userHandle):null,
    },
    clientExtensionResults:credential.getClientExtensionResults(),
    authenticatorAttachment:credential.authenticatorAttachment,
  };
}
function registrationOptions(o) {
  return {
    ...o,challenge:fromB64(o.challenge),
    user:{...o.user,id:fromB64(o.user.id)},
    excludeCredentials:(o.excludeCredentials||[]).map(c=>({...c,id:fromB64(c.id)})),
  };
}
function authenticationOptions(o) {
  return {...o,challenge:fromB64(o.challenge),
    allowCredentials:(o.allowCredentials||[]).map(c=>({...c,id:fromB64(c.id)})),
  };
}
function browserSupportsPasskeys() {
  return window.isSecureContext && !!window.PublicKeyCredential &&
    !!navigator.credentials?.create && !!navigator.credentials?.get;
}
function passkeyError(e) {
  const lookup={
    NO_PASSKEY_ENROLLED:"No passkey registered. Use your owner password once and select Enable biometrics.",
    OWNER_PASSWORD_REQUIRED:"Enter your current TradeDesk owner password before registering a passkey.",
    CHALLENGE_INVALID:"Biometric challenge expired. Try again.",
    PASSKEY_AUTH_FAILED:"Biometric verification failed. Try again or use your owner password.",
    PASSKEY_REGISTRATION_FAILED:"Could not verify this device. Try again.",
    PASSKEY_SERVICE_UNAVAILABLE:"The passkey service is unavailable. Use your owner password.",
    AUTH_CONFLICT_TRY_AGAIN:"Sign-in attempt conflicted. Try again.",
  };
  return lookup[e.message]||"Passkey not completed ("+(e.name==="NotAllowedError"?"cancelled or blocked":e.message)+").";
}
function displayBalances(data) {
  clear();
  if(!Array.isArray(data.balances)) throw Error("Invalid balance response");
  if(!data.balances.length) {
    status("Read-only VALR connection successful. No balances returned.");
    return;
  }
  status("Read-only VALR balances loaded at "+new Date(data.timestamp).toLocaleString()+
    ". These are exchange balances, NOT the virtual paper balance.");
  data.balances.forEach(b=>{
    const row=document.createElement("div");
    row.className="valr-row";
    const name=document.createElement("strong");name.textContent=b.currency;
    const val=document.createElement("span");
    val.textContent="Available: "+(b.available??"Not provided")+" · Total: "+(b.total??"Not provided");
    row.append(name,val);$("valrBalanceList").append(row);
  });
}
async function readBalance() {
  const field=$("valrOwnerPassword");
  const password=field.value.trim();
  field.value="";
  clear();
  $("valrReadBalance").disabled=true;
  status("Reading VALR balances securely...");
  try {
    const response=await fetch("/.netlify/functions/tradedesk-valr-balances",{
      method:"POST",credentials:"same-origin",cache:"no-store",
      headers:{
        "Content-Type":"application/json",
        ...(password?{"Authorization":"Bearer "+password}:{}),
      },
      body:"{}",signal:AbortSignal.timeout(35000),
    });
    const data=await response.json();
    if(!response.ok || !data.ok) {
      const errors={
        ACCESS_DENIED:"Please sign in with your fingerprint/passkey, or enter the TradeDesk owner password.",
        NOT_CONFIGURED:"The private VALR connection is not configured.",
        VALR_AUTH_FAILED:"VALR returned 401. Verify the VALR API credentials in Netlify.",
        VALR_ACCESS_RESTRICTED:"VALR denied the API key permission.",
        VALR_UNAVAILABLE:"VALR is not responding.",
      };
      status(errors[data.error]||"VALR balance unavailable ("+(data.error||"unknown")+").");
      if(data.error==="ACCESS_DENIED")await refreshStatus();
      return;
    }
    displayBalances(data);
  } catch {
    status("Couldn't read the balance. No trade or money movement occurred.");
  } finally {$("valrReadBalance").disabled=false;}
}
async function refreshStatus() {
  const supports=browserSupportsPasskeys();
  $("valrEnrollPasskey").disabled=!supports;
  try {
    const state=await postPasskey("status");
    passkeyEnrolled=state.enrolled;
    $("valrUsePasskey").disabled=!supports||!state.enrolled;
    $("valrSignOut").disabled=!state.signedIn;
    passStatus(state.signedIn?
      "Signed in securely for up to 8 hours. Read balances and scan markets without re-entering your password." :
      !supports?"Passkeys unavailable in this browser. Your owner password still works.":
      state.enrolled?
        "Passkey ready. Tap Use fingerprint / face unlock to sign in." :
        "Not enrolled yet. Enter your owner password ONCE and tap Enable biometrics.");
    if(!state.signedIn){clear();status("Private balances are locked. Public signals work without signing in.");}
  }catch {
    passStatus("Biometric sign-in not yet available. Owner password still works.");
  }
}
$("valrReadBalance").addEventListener("click",readBalance);
$("valrEnrollPasskey").addEventListener("click",async()=>{
  if(!browserSupportsPasskeys())return passStatus("Device passkeys are not supported here.");
  const field=$("valrOwnerPassword"),password=field.value.trim();
  field.value="";
  if(password.length<32)return passStatus("Enter the separate owner password once to register your phone.");
  $("valrEnrollPasskey").disabled=true;
  passStatus("Registering your device...");
  try {
    const started=await postPasskey("register-begin",{},password);
    const credential=await navigator.credentials.create({publicKey:registrationOptions(started.options)});
    if(!credential)throw Error("No passkey created");
    await postPasskey("register-finish",
      {challengeId:started.challengeId,credential:serialiseCredential(credential)},password);
    passkeyEnrolled=true;
    passStatus("Passkey registered! Future balance checks can use your fingerprint or face unlock.");
    await refreshStatus();
    await readBalance();
  } catch(e) {passStatus(passkeyError(e));}
  finally {$("valrEnrollPasskey").disabled=false;}
});
$("valrUsePasskey").addEventListener("click",async()=>{
  if(!browserSupportsPasskeys())return;
  $("valrUsePasskey").disabled=true;
  passStatus("Confirm your fingerprint, face unlock or device PIN...");
  try {
    const started=await postPasskey("login-begin");
    const credential=await navigator.credentials.get({publicKey:authenticationOptions(started.options)});
    if(!credential)throw Error("No passkey selected");
    await postPasskey("login-finish",
      {challengeId:started.challengeId,credential:serialiseCredential(credential)});
    passStatus("Biometric sign-in successful.");
    await refreshStatus();
    await readBalance();
  } catch(e) {passStatus(passkeyError(e));}
  finally {$("valrUsePasskey").disabled=!passkeyEnrolled;}
});
$("valrResetPasskeys").addEventListener("click",async()=>{
  const field=$("valrOwnerPassword");
  const password=field.value.trim();field.value="";
  if(password.length<32)return passStatus("Enter the owner password to remove registered biometrics.");
  if(!window.confirm("Remove ALL TradeDesk passkeys? You will need to register a device again with your owner password."))return;
  $("valrResetPasskeys").disabled=true;
  try {
    await postPasskey("reset-passkeys",{},password);
    passkeyEnrolled=false;
    clear();
    passStatus("Registered TradeDesk passkeys removed. If a device was lost or stolen, also rotate your owner password in Netlify to invalidate any remaining sessions.");
    status("Balance viewer signed out.");
    await refreshStatus();
  }catch(e){passStatus(passkeyError(e));}
  finally{$("valrResetPasskeys").disabled=false;}
});
$("valrSignOut").addEventListener("click",async()=>{
  try{await postPasskey("logout");clear();status("Signed out of the balance viewer.");}
  catch {passStatus("Sign-out failed; close this tab and try again.");}
  await refreshStatus();
});
refreshStatus();
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshStatus();});
setInterval(refreshStatus,60000);
})();
