import Stripe from 'stripe';
import { classify, feeFor } from '../lib/classify.js';
import { applicantAcceptance, reviewRequired, futureCohort, paymentConfirmation, adminNotification } from '../lib/emails.js';
export { classify, feeFor, applicantAcceptance, reviewRequired, futureCohort, paymentConfirmation, adminNotification };
export const site = () => (process.env.SITE_URL || 'https://workshop-motion-play-labs.vercel.app').replace(/\/$/,'');
export const adminEmail = () => process.env.ADMIN_EMAIL || 'justin@motionplaylabs.com';
export const configured = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
export function dbHeaders(){return {'apikey':process.env.SUPABASE_SERVICE_ROLE_KEY,'Authorization':'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'};}
export async function db(path,{method='GET',body,prefer}={}) {
 if (!configured()) throw new Error('Database not configured');
 const res=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{...dbHeaders(),...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 const data=await res.json().catch(()=>null);
 if (!res.ok){const err=new Error('Database operation failed');err.status=res.status;err.code=data?.code;throw err;}
 return data;
}
export async function rpc(name, body){return db('rpc/'+name,{method:'POST',body});}
export const seats=async()=>{const d=await db('workshop_cohorts?id=eq.cohort-01&select=capacity,confirmed_count');return {capacity:d[0]?.capacity??8,paid:d[0]?.confirmed_count??0,remaining:Math.max(0,(d[0]?.capacity??8)-(d[0]?.confirmed_count??0))};};
export const stripe=()=>{const key=process.env.STRIPE_SECRET_KEY;const mode=process.env.STRIPE_PAYMENT_MODE;if(!key||!((mode==='live'&&key.startsWith('sk_live_'))||(mode==='test'&&key.startsWith('sk_test_'))))return null;return new Stripe(key);};
export async function mail(to,msg){
 if(!process.env.RESEND_API_KEY) return {sent:false};
 const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESEND_FROM||'MotionPlay Labs <hello@motionplaylabs.com>',to:[to],subject:msg.subject,html:msg.html,text:msg.text})});
 if(!res.ok) throw new Error('Transactional email unavailable');
 return {sent:true};
}
export async function notifyAdmin(a,label,s){
 const lines=[label,'Name: '+a.full_name,'Email: '+a.email,'AI level: '+a.ai_experience,'Classification: '+a.classification,'Project: '+a.project_goal,'Reference: '+a.reference,'Confirmed: '+s.paid+'/8'];
 return mail(adminEmail(),{subject:'Build Session: '+label+' — '+a.reference,text:lines.join('\n'),html:'<div style="font-family:Arial;max-width:540px"><img src="https://d2ol7oe51mr4n9.cloudfront.net/user_3B7NW37kNCO9R3JjEQ3Re2UR4ee/33f6247e-a677-4e37-9ca6-0fad86efc4d4.png" alt="MotionPlay Labs" width="132" style="display:block;width:132px;height:auto;margin:0 0 14px"/><pre style="font-family:Arial;white-space:pre-wrap">'+lines.map(x=>x.replace(/&/g,'&amp;').replace(/</g,'&lt;')).join('\n')+'</pre></div>'});
}
export const applicationResult = (a) => ({classification:a.classification,score:a.score,breakdown:a.breakdown,rulesVersion:'v1'});
export function method(req,res,expected){if(req.method!==expected){res.status(405).json({ok:false,error:'Method not allowed'});return false;}return true;}
export function adminOk(req){const expected=process.env.ADMIN_TOKEN;const token=req.headers['x-admin-token'];return !!(expected&&token&&String(token)===expected);}
