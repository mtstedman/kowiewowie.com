-- Additive successor. Preserve all version-28 objects and historical migration bytes.
CREATE TABLE romjs_netplay3_rooms (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{32}$'),
 package text NOT NULL CHECK(length(package)<=64),
 artifact text NOT NULL CHECK(artifact ~ '^[a-f0-9]{64}$'),
 origin text NOT NULL CHECK(length(origin)<=200),
 host_hash text NOT NULL CHECK(host_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 host_lease_until timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '60 seconds'),
 state jsonb NOT NULL CHECK(jsonb_typeof(state)='object' AND octet_length(state::text)<=524288)
);
CREATE INDEX romjs_netplay3_lease ON romjs_netplay3_rooms(host_lease_until);
COMMENT ON TABLE romjs_netplay3_rooms IS 'Protocol 3 package-bound rooms: 32 service-admitted rooms, four watch invitations/participants plus one play participant, renewable host authorization, independent bounded signaling state';
