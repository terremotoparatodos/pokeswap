# Multiplayer performance benchmark

`npm run benchmark:multiplayer` drives the real Colyseus WebSocket transport.
It does not call `PresenceRoom` methods directly and it does not need Supabase
accounts. The server enables synthetic identities only when
`PRESENCE_BENCHMARK=on` and `NODE_ENV` is not `production`.

## Usage

Run one density for 60 seconds after a five-second warm-up:

```text
npm run benchmark:multiplayer -- --players 50 --duration 60 --warmup 5
```

Use `--area pradera` (or the `wild` alias) to move the synthetic crowd to the
wild spawn before the measured period. Durations up to 3,600 seconds are
accepted for interactive and soak sessions.

`--prefix city` gives a second concurrent driver distinct synthetic ids. This
is useful for keeping crowds in town and wild on the same benchmark server.

Supported density range is 1–100. Reproduce the capacity matrix with:

```text
npm run benchmark:multiplayer -- --players 10 --duration 60 --warmup 5
npm run benchmark:multiplayer -- --players 25 --duration 60 --warmup 5
npm run benchmark:multiplayer -- --players 50 --duration 60 --warmup 5
npm run benchmark:multiplayer -- --players 100 --duration 60 --warmup 5
```

The command starts and stops its own local realtime server. `--port` changes
the default port 2568. `--url ws://... --external-server` targets an already
running benchmark-enabled server.

Every run prints one JSON document with:

- join duration;
- physical WebSocket messages and logical updates contained in batches;
- estimated serialized payload bytes;
- p50/p95/p99/max acknowledgement RTT;
- p95/p99/max event-loop delay in the load driver;
- move rejections, which make the command fail.

The byte count is `JSON.stringify([messageType, payload])`, not a packet
capture. It is stable enough for comparisons between commits but does not
include WebSocket/HTTP framing or Colyseus codec overhead.

## Browser + renderer run

For the renderer measurement, start Vite with `VITE_PERF=on` and
`VITE_REALTIME_URL` pointing to the benchmark server, then open Ciudad Corazón
as a guest observer while the driver runs. A browser observer consumes one of
the room's 100 connection slots.

The first verified local run used a 724×900 viewport and 50 synthetic players,
all moving near the town spawn. After warm-up the HUD reported:

| Metric | Result |
| --- | ---: |
| FPS | 60 |
| Frame average | 1.5 ms |
| Frame p95 | 1.9 ms |
| Frame p99 | 2.2 ms |
| Frame maximum | 2.6 ms |
| Frames >33 ms | 0% |
| Remote actors | 50 |
| Remote updates | 369.2/s |
| Sprite phase | 0.4 ms |

The city rendered correctly and no new application error appeared. Warnings
about unavailable Pokédex/plaza data were expected because this isolated run
used a deliberately nonexistent local Supabase endpoint.

The later city-motion profile used 30 synthetic players plus the restored town
residents. Before removing the CPU town-model path, camera movement measured
10.6 ms/frame on average, 21.4 ms p95, and 9.7 ms in the sprite/model phase.
With the same 2D visual content rendered from pre-baked façade sprites, the same
movement measured 1.4 ms/frame, 2.2 ms p95, 3.1 ms p99, 3.3 ms maximum, and
0% of frames over 33 ms. The sprite phase fell to 0.3 ms while holding 60 FPS.

## Initial transport matrix

Five measured seconds per density, after one second of warm-up, on the local
development machine:

| Players | Join | Socket msg/s | Logical updates/s | Estimated KiB/s | RTT p95 | RTT p99 | Rejected |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 25 | 359 ms | 334 | 3,955 | 827 | 3.73 ms | 5.35 ms | 0 |
| 50 | 646 ms | 727 | 16,619 | 3,410 | 6.80 ms | 10.67 ms | 0 |
| 100 | 1,106 ms | 1,375 | 65,170 | 13,237 | 16.03 ms | 20.68 ms | 0 |

These actors deliberately remain clustered within the town AOI. This is a
worst-density test: interest management should not hide actors that really are
on screen together. Batching keeps physical message growth much lower than
logical update growth, while the latter still approaches O(N²) when every
viewer can see every mover. The 50-player browser result shows that the current
incremental client can absorb that target density on this machine; lower-end
hardware and adverse-network runs remain separate gates.
