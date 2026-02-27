# OpenAI API: rate limits and timeouts

## Timeouts

Summary and chat routes are configured to run up to **60 seconds** (`maxDuration = 60`). The request to OpenAI aborts after **55 seconds** so the app can return a clear "Request timed out" message instead of the connection dropping.

- **Vercel Free**: Serverless functions are limited to **10 seconds**. If you hit that, the route is killed before OpenAI responds. Upgrade to Pro (or run the app locally) to use the full 60s.
- **Vercel Pro**: You get up to 60s (or more with a higher `maxDuration`). If the summary still times out, try again; the model may be under load.

"Too many requests" from the OpenAI API usually means you hit a **per-minute** limit, even on enterprise accounts. Limits are not unlimited.

## What’s limited?

1. **RPM (requests per minute)**  
   How many API calls you can make per minute. Clicking "Generate summary" or sending chat messages repeatedly in a short time can hit this.

2. **TPM (tokens per minute)**  
   How many input + output tokens you can use per minute. One summary request = system prompt + full metrics bundle (input) + model response (output). Larger payloads use more input tokens and can push you over TPM.

3. **Payload size**  
   The app sends a **bounded** summary bundle (aggregated KPIs, top 10/20 agency lists, cohort highlights). It does **not** send the full agency list. We send that bundle as **compact JSON** (no pretty-print) to keep token count down. So "amount of data" is controlled, but one big snapshot + long response can still be a large token request.

## What to do

- **Wait and retry**  
  The app retries on 429 with backoff (2s, 4s, 8s). If you still see the message, wait about a minute and try again.

- **Space out requests**  
  Avoid multiple "Generate" or chat submissions in the same minute.

- **Check limits in the OpenAI dashboard**  
  Usage → see requests and tokens per minute. Confirm your tier’s RPM/TPM and whether you’re at the cap.

- **Enterprise / admin**  
  If 429s persist, your org may have a custom cap. Ask your admin to check the OpenAI project/organization limits or request an increase.

## Summary

429 is almost always **rate** (requests or tokens per minute), not "you sent too much in one request." Payload size does affect tokens and thus TPM; we keep it bounded and compact. If you’re still hitting limits, slow down requests or have your admin raise the per-minute limits.
