# Test users

Accounts used to exercise sign-in and the studio on **staging** (Supabase project `ltaxhznuixoslbbcjkts`).
Never create these in production.

| Label | Email | Environment | Method |
|---|---|---|---|
| test1 | `motionfxfrenzy+test1@gmail.com` | staging | email + password |

- **Password:** not stored in the repo. It is in the gitignored `.env.credentials` as
  `STAGING_TEST_USER_PASSWORD`. It is weak by design (staging only), so keep it out of production.
- **Mail:** Gmail plus-addressing delivers to the `motionfxfrenzy@gmail.com` inbox, so confirmation and
  password-reset emails (sent through Resend SMTP) land there.
- **Creating the user:** sign up by hand at `https://greedy-motion-staging.vercel.app/auth?mode=signup`
  (or `http://localhost:3000/auth?mode=signup`, which also uses the staging project), then click the
  confirmation link. Or in the Supabase dashboard: Authentication > Users > Add user, with
  "Auto Confirm User" ticked.
- **Google sign-in:** `motionfxfrenzy@gmail.com` is the Google test user for the staging OAuth client.

To add another user, copy the row and use the next `+testN` address.
