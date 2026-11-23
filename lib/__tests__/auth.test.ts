// #182: sign-in logic (lib/auth/auth.ts) on a hand-written fake of the browser client, plus source guards that pin
// the decided design: implicit flow (no PKCE, no code exchange), no sign-ups from the login form, one client.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  ALLOW_LIST_TABLE,
  checkAllowed,
  isAuthGateOn,
  loginRedirectUrl,
  normalizeEmail,
  parseAuthHashError,
  sendMagicLink,
  signInErrorMessage,
  signOutUser,
} from "../auth/auth.ts";
import type { AuthClientLike } from "../auth/auth.ts";

interface Fake {
  client: AuthClientLike;
  otpCalls: Array<{ email: string; options: { shouldCreateUser: boolean; emailRedirectTo: string } }>;
  queries: Array<{ table: string; cols: string; col: string; value: string }>;
  signOutCalls: number;
}

function fakeClient(opts: {
  otpError?: { message: string; status?: number; code?: string } | null;
  throwOtp?: boolean;
  row?: { data: unknown; error: { message: string; code?: string } | null };
} = {}): Fake {
  const fake: Fake = { client: null as unknown as AuthClientLike, otpCalls: [], queries: [], signOutCalls: 0 };
  fake.client = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOtp: async (args) => {
        fake.otpCalls.push(args);
        if (opts.throwOtp) throw new Error("network down");
        return { error: opts.otpError ?? null };
      },
      signOut: async () => {
        fake.signOutCalls++;
        return { error: null };
      },
    },
    from: (table) => ({
      select: (cols) => ({
        eq: (col, value) => ({
          maybeSingle: async () => {
            fake.queries.push({ table, cols, col, value });
            return opts.row ?? { data: null, error: null };
          },
        }),
      }),
    }),
  };
  return fake;
}

// ---- gate and helpers ------------------------------------------------------------------------------------------

test("isAuthGateOn: only the supabase adapter turns the gate on", () => {
  assert.equal(isAuthGateOn("supabase"), true);
  assert.equal(isAuthGateOn(" Supabase "), true);
  for (const raw of [undefined, null, "", "local", "mock", "local/mock", "junk"]) {
    assert.equal(isAuthGateOn(raw), false, String(raw));
  }
});

test("normalizeEmail: trims, lowercases, and requires a@b.c", () => {
  assert.equal(normalizeEmail("  DarkSigmer@Proton.me "), "darksigmer@proton.me");
  for (const raw of ["", "foo", "a@b", "a b@c.d"]) assert.equal(normalizeEmail(raw), null, raw);
});

test("loginRedirectUrl: always ends in /login with no double slash", () => {
  assert.equal(loginRedirectUrl("https://mogmine.vercel.app/"), "https://mogmine.vercel.app/login");
  assert.equal(loginRedirectUrl("https://mogmine.vercel.app"), "https://mogmine.vercel.app/login");
  assert.equal(loginRedirectUrl("http://localhost:3000"), "http://localhost:3000/login");
});

// ---- magic link ------------------------------------------------------------------------------------------------

test("sendMagicLink: one signInWithOtp with shouldCreateUser false and the login redirect, email lowercased", async () => {
  const fake = fakeClient();
  const result = await sendMagicLink(fake.client, "  DarkSigmer@Proton.me ", "https://mogmine.vercel.app/");
  assert.deepEqual(result, { ok: true, email: "darksigmer@proton.me" });
  assert.equal(fake.otpCalls.length, 1);
  assert.deepEqual(fake.otpCalls[0], {
    email: "darksigmer@proton.me",
    options: { shouldCreateUser: false, emailRedirectTo: "https://mogmine.vercel.app/login" },
  });
});

test("sendMagicLink: an invalid email never reaches the client", async () => {
  const fake = fakeClient();
  const result = await sendMagicLink(fake.client, "not-an-email", "https://mogmine.vercel.app");
  assert.equal(result.ok, false);
  assert.equal(fake.otpCalls.length, 0);
});

test("sendMagicLink: a thrown client error becomes the generic message", async () => {
  const fake = fakeClient({ throwOtp: true });
  const result = await sendMagicLink(fake.client, "a@b.co", "http://localhost:3000");
  assert.deepEqual(result, { ok: false, message: "Couldn't send the sign-in link. Check your connection and try again." });
});

test("signInErrorMessage: rate limit, not-set-up and generic copy; raw server text is never echoed", () => {
  assert.match(signInErrorMessage({ message: "Email rate limit exceeded", status: 429 }), /2 an hour/);
  assert.match(signInErrorMessage({ message: "over_email_send_rate_limit", status: 200 }), /2 an hour/);
  assert.match(signInErrorMessage({ message: "Signups not allowed for otp", status: 422 }), /isn't set up/);
  assert.match(signInErrorMessage({ message: "User not found", status: 400 }), /isn't set up/);
  const generic = signInErrorMessage({ message: "token=abc123 internal stack trace", status: 500 });
  assert.equal(generic, "Couldn't send the sign-in link. Check your connection and try again.");
  assert.doesNotMatch(generic, /token|abc123/);
});

test("sendMagicLink: maps the server error into the result", async () => {
  const fake = fakeClient({ otpError: { message: "Signups not allowed for otp", status: 422 } });
  const result = await sendMagicLink(fake.client, "stranger@example.com", "https://mogmine.vercel.app");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /isn't set up/);
});

// ---- allow-list ------------------------------------------------------------------------------------------------

test("checkAllowed: a readable own row is allowed, queried by table and uid", async () => {
  const uid = "00000000-0000-4000-8000-000000000001";
  const fake = fakeClient({ row: { data: { user_id: uid }, error: null } });
  assert.equal(await checkAllowed(fake.client, uid), "allowed");
  assert.deepEqual(fake.queries, [{ table: ALLOW_LIST_TABLE, cols: "user_id", col: "user_id", value: uid }]);
  assert.equal(ALLOW_LIST_TABLE, "mogmine_allowed_users");
});

test("checkAllowed: no row is not-authorized; an error is error, never allowed", async () => {
  const uid = "00000000-0000-4000-8000-000000000002";
  assert.equal(await checkAllowed(fakeClient({ row: { data: null, error: null } }).client, uid), "not-authorized");
  assert.equal(await checkAllowed(fakeClient({ row: { data: null, error: { message: "boom" } } }).client, uid), "error");
  assert.equal(await checkAllowed(fakeClient({ row: { data: { user_id: uid }, error: { message: "partial" } } }).client, uid), "error");
});

// ---- hash errors and sign-out ----------------------------------------------------------------------------------

test("parseAuthHashError: an expired link gets the friendly message; a token hash and an empty hash get null", () => {
  const message = parseAuthHashError("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
  assert.ok(message && /expired/.test(message));
  assert.equal(parseAuthHashError("#access_token=abc"), null);
  assert.equal(parseAuthHashError(""), null);
});

test("signOutUser: calls the client's signOut once and never throws", async () => {
  const fake = fakeClient();
  await signOutUser(fake.client);
  assert.equal(fake.signOutCalls, 1);
  const broken = fakeClient();
  broken.client.auth.signOut = async () => {
    throw new Error("offline");
  };
  await assert.doesNotReject(signOutUser(broken.client));
});

// ---- source guards ---------------------------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [rel] : [];
  });
}

const PRODUCTION = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")];
const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

test("guard: the browser client uses the implicit flow with URL detection and no code-exchange flow", () => {
  const source = read("lib/persistence/supabase-client.ts");
  assert.ok(source.includes('flowType: "implicit"'));
  assert.ok(source.includes("detectSessionInUrl: true"));
  assert.doesNotMatch(source, /pkce/i);
});

test("guard: no code exchange and no sign-up from the login flow", () => {
  for (const file of PRODUCTION) {
    const source = read(file);
    assert.equal(source.includes("exchangeCodeForSession"), false, `${file} exchanges a code`);
    assert.equal(source.includes("shouldCreateUser: true"), false, `${file} allows sign-up`);
  }
});

// The directive is the first statement of a file. A comment that merely mentions it does not count.
const isClientModule = (source: string) => /^\s*["']use client["']/m.test(source);

test("guard: the service-role key never appears in client code", () => {
  for (const file of PRODUCTION) {
    const source = read(file);
    if (isClientModule(source)) assert.equal(source.includes("SUPABASE_SERVICE_ROLE_KEY"), false, file);
  }
});

test("guard (#185a): the service-role key is read only by the server-only agent auth module", () => {
  const readers = PRODUCTION.filter((file) => read(file).includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.deepEqual(readers, ["lib/agent/server-auth.ts"]);
});

test("guard (#185a): no 'use client' file imports the server-only agent modules", () => {
  for (const file of PRODUCTION) {
    const source = read(file);
    if (!isClientModule(source)) continue;
    assert.doesNotMatch(source, /lib\/agent\/(server-auth|handle)|\.\.?\/agent\/(server-auth|handle)/, file);
  }
  assert.match(read("lib/agent/server-auth.ts").split("\n")[0], /^\/\/ Server only\./);
});

test("guard: exactly one createClient( call in browser code; every other one is in the agent server-auth module", () => {
  const browser = PRODUCTION.filter((file) => /\bcreateClient\(/.test(read(file)) && !file.startsWith("lib/agent/"));
  assert.deepEqual(browser, ["lib/persistence/supabase-client.ts"]);
  assert.equal((read("lib/persistence/supabase-client.ts").match(/\bcreateClient\(/g) ?? []).length, 1);
  const elsewhere = PRODUCTION.filter((file) => /\bcreateClient\(/.test(read(file)) && file.startsWith("lib/agent/"));
  assert.deepEqual(elsewhere, ["lib/agent/server-auth.ts"]);
});

test("guard (#185a): nothing under app/api/v1 or lib/agent writes a journal table with the service role", () => {
  const server = [...sourceFiles("app/api/v1"), ...sourceFiles("lib/agent")];
  for (const file of server) {
    const source = read(file);
    assert.doesNotMatch(source, /\.from\(\s*["'`]mogmine_(?!agent_)/, `${file} queries a journal table directly`);
  }
  const auth = read("lib/agent/server-auth.ts");
  assert.equal(auth.includes("service") && auth.includes("mogmine_trades"), false);
});
