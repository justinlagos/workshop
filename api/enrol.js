export default function handler(req,res) { res.status(503).json({ok:false,error:'Enrolment is temporarily unavailable while secure storage and payment verification are configured.'}); }
