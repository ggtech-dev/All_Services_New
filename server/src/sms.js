// Sends OTP SMS through 2Factor.in (₹0.165 per delivered OTP). The code itself is made and checked by our server.
// SMS_2FACTOR_API_KEY in .env switches real SMS on. Without it: test mode — the code is printed in the server
// terminal and, outside production, shown on the login screen. SMS_2FACTOR_TEMPLATE = optional template name.
export const SMS_TEST_MODE = !process.env.SMS_2FACTOR_API_KEY;

export async function sendOtpSms(phone, code) {
  if (SMS_TEST_MODE) {
    console.log(`\n📱 [TEST MODE — SMS not sent] To: +91 ${phone}  OTP: ${code}\n`);
    return;
  }
  const key = encodeURIComponent(process.env.SMS_2FACTOR_API_KEY.trim());
  const template = process.env.SMS_2FACTOR_TEMPLATE ? `/${encodeURIComponent(process.env.SMS_2FACTOR_TEMPLATE.trim())}` : '';
  const res = await fetch(`https://2factor.in/API/V1/${key}/SMS/+91${phone}/${code}${template}`, { signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.Status !== 'Success') {
    // never log the API key; the provider's message is enough to see what went wrong
    console.error('2Factor SMS failed:', res.status, body.Details || body.Status || '');
    throw Object.assign(new Error('We could not send the SMS right now. Please try again, or log in with email.'), { status: 502 });
  }
}
