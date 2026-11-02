# Authentication and account access

[Architecture index](README.md)

## How to read this diagram

Identity is managed by Supabase Auth. Application APIs verify the user and then
access Postgres with that user's token. The publishable project key is not proof
of user identity and does not bypass row-level security (RLS).

```mermaid
sequenceDiagram
  actor User
  participant UI as Browser React app
  participant SDK as Supabase browser SDK
  participant Auth as Supabase Auth
  participant API as Next.js account API
  participant DB as Postgres with RLS and owned RPCs
  User->>UI: Create account with email and password
  UI->>SDK: signUp() with current-origin email redirect
  SDK->>Auth: Signup request
  Auth-->>SDK: Signup response with optional session
  opt Email confirmation enabled in project settings
    Auth-->>User: Confirmation email
    User->>Auth: Open confirmation link
    Auth-->>UI: Redirect to allowed app origin
    SDK->>SDK: Detect session in callback URL, when provided
  end
  opt No session yet
    User->>UI: Sign in with email and password
    UI->>SDK: signInWithPassword()
    SDK->>Auth: Verify credentials
    Auth-->>SDK: Access token and refresh token
  end
  SDK->>SDK: Persist session and refresh access tokens automatically
  SDK-->>UI: onAuthStateChange(session)
  UI->>UI: Select account mode and clear browser workspace from view
  UI->>API: GET /api/workspace with bearer access token
  API->>Auth: auth.getUser(token)
  alt Verified user
    Auth-->>API: Verified user identity
    API->>DB: Query using publishable key and user bearer token
    DB->>DB: Apply RLS, RPCs check auth.uid() and ownership
    DB-->>API: Accessible account rows
    API-->>UI: Workspace JSON
  else Missing, expired, or invalid session
    Auth-->>API: Verification failure
    API-->>UI: Unauthorized, sign-in guidance
  end
  User->>UI: Sign out
  UI->>SDK: auth.signOut()
  SDK-->>UI: Session becomes null
  UI->>UI: Restore browser workspace, do not delete account rows
```

## Session and storage boundaries

- Browser initialization validates public Supabase settings and creates a
  `supabase-js` client. SDK defaults enable session persistence, token refresh and
  URL session detection with implicit flow. This app does not implement server
  authentication cookies or an SSR PKCE callback route.
- Password submission goes from the browser SDK to Supabase Auth. App API calls
  use `Authorization: Bearer <user-access-token>`. Server clients disable their
  own session persistence/refresh and call `auth.getUser(token)` for verification.
- Auth-state changes drive `mode`; browser and account records are not merged or
  migrated automatically. General-practice notes remain local even for accounts,
  under separate browser/account keys. Target-specific preparation is account
  persisted when signed in.
- The server verifies identity; RLS and explicitly owned database functions
  enforce record access. An API call does not acquire a service-role credential.
  Configuration rejects secret/service-role keys in the public-key setting.
- Supabase signup availability, confirmation email delivery, confirmation
  requirements and allowed redirects are external project settings, not guarantees
  made by this code. Signup without a session displays confirmation/sign-in
  guidance. Use the [setup checklist](../../README.md#optional-supabase-storage--hosted-use).

Unauthenticated development inference is a separate access mode, not a Supabase
anonymous user account. It requires the explicit local guard and does not grant
account database access. An account request with an invalid bearer token fails;
it does not fall back to anonymous access.

## Implementation

- [Browser client, auth subscription and sign-in form](../../components/workspace.tsx),
  [public configuration validation](../../lib/supabase-config.ts), and
  [server identity/access checks](../../lib/server.ts).
- [Workspace API](../../app/api/workspace/route.ts),
  [preparation API](../../app/api/preparation/route.ts),
  [base RLS](../../supabase/migrations/001_workspace.sql), and
  [preparation RLS/RPC](../../supabase/migrations/004_preparation_targets.sql).
