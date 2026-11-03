// Prints fresh secrets for the production environment (JWT + web-push VAPID keys).
// Run:  npm run gen:secrets   then paste the values into Render's environment settings.
const crypto = require("crypto");
const webpush = require("web-push");

const secret = () => crypto.randomBytes(48).toString("base64url");
const vapid = webpush.generateVAPIDKeys();

console.log("# Paste these into your hosting provider's environment variables (Render).");
console.log("# Keep them private. Never commit them.\n");
console.log(`JWT_ACCESS_SECRET=${secret()}`);
console.log(`JWT_REFRESH_SECRET=${secret()}`);
console.log(`VAPID_PUBLIC_KEY=${vapid.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapid.privateKey}`);
console.log("VAPID_MAILTO=mailto:you@example.com");
console.log("\n# The frontend (Vercel) needs the SAME public key:");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapid.publicKey}`);
