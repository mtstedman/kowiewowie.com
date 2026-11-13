CREATE TABLE romjs_netplay_gate (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 window_at timestamptz NOT NULL DEFAULT now(), requests integer NOT NULL DEFAULT 0,
 create_window timestamptz NOT NULL DEFAULT now(), creates integer NOT NULL DEFAULT 0
);
INSERT INTO romjs_netplay_gate(singleton) VALUES(true);
CREATE TABLE romjs_netplay_buckets (
 slot integer PRIMARY KEY CHECK(slot BETWEEN 0 AND 1023),
 window_at timestamptz NOT NULL DEFAULT now(), requests integer NOT NULL DEFAULT 0,
 create_window timestamptz NOT NULL DEFAULT now(), creates integer NOT NULL DEFAULT 0
);
INSERT INTO romjs_netplay_buckets(slot) SELECT generate_series(0,1023);
CREATE TABLE romjs_netplay_rooms (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{32}$'),
 game text NOT NULL CHECK(length(game)<=100),
 artifact text NOT NULL CHECK(artifact ~ '^[a-f0-9]{64}$'),
 origin text NOT NULL CHECK(length(origin)<=200),
 host_hash text NOT NULL CHECK(host_hash ~ '^[a-f0-9]{64}$'),
 invite_hash text CHECK(invite_hash ~ '^[a-f0-9]{64}$'),
 guest_hash text CHECK(guest_hash ~ '^[a-f0-9]{64}$'),
 session text NOT NULL DEFAULT '' CHECK(session='' OR session ~ '^[a-f0-9]{32}$'),
 join_id text NOT NULL DEFAULT '' CHECK(join_id='' OR join_id ~ '^[a-f0-9]{32}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 invite_expires_at timestamptz NOT NULL,
 host_lease_until timestamptz NOT NULL DEFAULT (now()+interval '60 seconds'),
 host_seen timestamptz NOT NULL DEFAULT now(), guest_seen timestamptz,
 round text NOT NULL DEFAULT '' CHECK(round='' OR round ~ '^[a-f0-9]{32}$'),
 round_mode text NOT NULL DEFAULT 'rebuild' CHECK(round_mode IN ('restart','rebuild')),
 round_at timestamptz,
 recovery text NOT NULL DEFAULT 'none' CHECK(recovery IN ('none','restart','rebuild')),
 host_sdp text CHECK(octet_length(host_sdp)<=32768),
 guest_sdp text CHECK(octet_length(guest_sdp)<=32768),
 host_turn_until bigint NOT NULL DEFAULT 0, guest_turn_until bigint NOT NULL DEFAULT 0,
 host_poll timestamptz, guest_poll timestamptz,
 host_requests integer NOT NULL DEFAULT 0, guest_requests integer NOT NULL DEFAULT 0,
 host_window timestamptz NOT NULL DEFAULT now(), guest_window timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX romjs_netplay_lease ON romjs_netplay_rooms(host_lease_until);
COMMENT ON TABLE romjs_netplay_rooms IS 'At most 128 service-admitted two-role rooms; renewable host lease, separately expiring unused invites, two replaceable SDP slots; no absolute active-session deadline';
