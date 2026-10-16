export default function handler(req,res) { res.status(200).json({ok:true,hosting:'vercel',registrationReady:false,reason:'Persistent database and payment integrations not yet configured'}); }
