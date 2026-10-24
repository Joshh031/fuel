import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signInWithRedirect, getRedirectResult,
  setPersistence, indexedDBLocalPersistence, browserLocalPersistence, signOut } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';

const app = getApps().length ? getApp() : initializeApp({
  apiKey:'AIzaSyCcEKJOMx5nLuD_ftGLu0NBPJ8yr5FnekI',
  authDomain:'familyhub-d72f8.firebaseapp.com', projectId:'familyhub-d72f8',
  appId:'1:242948947064:web:fa31a7165c6f2d4f1f818d',
});
const auth = getAuth(app);
const OWNER = 'DGmCAedCrNNBBURG55rFQOWKKba2';
const API = 'https://vphqjxjphdsdpqaxqkpf.supabase.co/functions/v1/fuel-data';
const provider = new GoogleAuthProvider();
provider.setCustomParameters({prompt:'select_account'});
let initialized = false;
const panel = document.getElementById('fuel-auth-panel');
const button = document.getElementById('fuel-sign-in');
const status = document.getElementById('fuel-auth-status');
function lock(message = 'Sign in with your Google account to open your nutrition log.') {
  document.body.classList.add('fuel-locked');
  document.querySelector('.app').inert = true;
  panel.hidden = false;
  status.textContent = message;
  button.disabled = false;
}
function message(error) {
  if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') return 'Sign-in was closed. Tap below to try again.';
  if (error?.code === 'auth/unauthorized-domain') return 'This FUEL address needs to be enabled for sign-in. Your data remains private.';
  return 'Sign-in could not finish. Please try again.';
}
async function login() {
  button.disabled = true; status.textContent = 'Opening Google sign-in…';
  try { await signInWithPopup(auth,provider); }
  catch (error) {
    if (error?.code === 'auth/popup-blocked') {
      try { await signInWithRedirect(auth,provider); return; } catch (next) { lock(message(next)); }
    } else lock(message(error));
  }
}
async function token(force = false) {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER || !user.emailVerified) { lock(); throw new Error('Sign in to FUEL first.'); }
  return user.getIdToken(force);
}
async function request(operation) {
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch(API,{method:'POST',cache:'no-store',credentials:'omit',
      headers:{Authorization:'Bearer '+await token(attempt > 0),'Content-Type':'application/json'},body:JSON.stringify(operation)});
    if (response.status !== 401 || attempt === 1) break;
  }
  const data = await response.json().catch(()=>({error:'Unable to reach FUEL. Please retry.'}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) lock('Please sign in again to access your nutrition log.');
    const error = new Error(data.error || 'Unable to save or load data.');
    window.showToast?.(error.message,4500);
    throw error;
  }
  return data;
}
window.FuelAuth = {request,login,signOut:async()=>{lock();await signOut(auth);location.reload();}};
button.addEventListener('click',login);
document.getElementById('fuel-sign-out').addEventListener('click',()=>window.FuelAuth.signOut());
try { await setPersistence(auth,indexedDBLocalPersistence); }
catch { try { await setPersistence(auth,browserLocalPersistence); } catch {} }
try { await getRedirectResult(auth); } catch (error) { lock(message(error)); }
onIdTokenChanged(auth,async user=>{
  if (!user) { lock(); return; }
  if (user.uid !== OWNER || !user.emailVerified) { lock('This Google account does not have access to FUEL. Choose the owner account.'); return; }
  try {
    const result = await user.getIdTokenResult();
    if (result.claims.firebase?.sign_in_provider !== 'google.com') { lock('Use Google sign-in to open FUEL.'); return; }
    panel.hidden = true;
    document.body.classList.remove('fuel-locked');
    document.querySelector('.app').inert = false;
    if (!initialized) { initialized = true; window.init(); }
  } catch { lock('Your session could not be restored. Please sign in again.'); }
});
