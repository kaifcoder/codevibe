# CodeVibe Kubernetes Manifests

Deploys CodeVibe's backend services — **excluding** Next.js, which is
expected to run on Vercel / a separate platform.

## What's deployed

| Component | How | Why it's here |
|---|---|---|
| `langgraph-api` (Agent Server + queue worker) | Official Helm chart `langchain/langgraph-cloud` | LangGraph's [recommended way to deploy on K8s](https://docs.langchain.com/langsmith/deploy-standalone-server) |
| `langgraph-redis` (pub-sub for streaming) | Bundled with the Helm chart | Required by the Agent Server |
| **Postgres (managed, external)** | One managed instance, two databases (`codevibe` + `langgraph`) | Backs both Prisma's `Session` table and LangGraph's checkpoints/threads/runs — see `10-secrets.example.yaml` |
| `yjs-server` (Hocuspocus WebSocket) | Deployment (`30-yjs-server.yaml`) | Real-time collaborative editing |

## Prerequisites

- Kubernetes 1.27+ with a default StorageClass (only needed if you keep `yjs-server` PVCs — there are none today)
- Helm 3
- A container registry you can push to (ECR / GAR / GHCR / Docker Hub)
- A managed Postgres instance reachable from the cluster (RDS / Cloud SQL / Azure DB / SAP HANA Cloud Postgres). Create two databases up-front:
  ```sql
  CREATE DATABASE codevibe;   -- for Prisma
  CREATE DATABASE langgraph;  -- for LangGraph checkpoints
  ```
  The LangGraph user needs `CREATE EXTENSION` privilege the first time it boots (it installs `btree_gin`, `btree_gist`, `pgcrypto`, `citext`, `ltree`, `pg_trgm`).
- An Ingress controller if you want browser access to `yjs-server` and the
  agent API (`50-ingress.example.yaml` assumes ingress-nginx + cert-manager)

## Build & push the two custom images

```bash
# Agent server image — uses Dockerfile.agent at the repo root
docker build -t ghcr.io/YOUR_ORG/codevibe-langgraph-api:latest -f Dockerfile.agent .
docker push   ghcr.io/YOUR_ORG/codevibe-langgraph-api:latest

# Yjs/Hocuspocus image — uses Dockerfile.yjs at the repo root
docker build -t ghcr.io/YOUR_ORG/codevibe-yjs:latest -f Dockerfile.yjs .
docker push   ghcr.io/YOUR_ORG/codevibe-yjs:latest
```

Update the `image:` fields in `30-yjs-server.yaml` and
`40-langgraph.values.yaml` to point at your tags.

## Install

```bash
# 1. Namespace
kubectl apply -f k8s/00-namespace.yaml

# 2. Secrets (copy the example, fill in real values, apply)
cp k8s/10-secrets.example.yaml k8s/10-secrets.yaml
# … edit k8s/10-secrets.yaml — fill in DATABASE_URL + connection_url
#    pointing at your managed Postgres instance …
kubectl apply -f k8s/10-secrets.yaml

# 3. Yjs / Hocuspocus
kubectl apply -f k8s/30-yjs-server.yaml

# 4. LangGraph Agent Server (preferred path: Helm chart)
helm repo add langchain https://langchain-ai.github.io/helm
helm repo update
helm upgrade --install langgraph langchain/langgraph-cloud \
  --namespace codevibe \
  --values k8s/40-langgraph.values.yaml

# 5. (Optional) Ingress for browser-facing WS / API
kubectl apply -f k8s/50-ingress.example.yaml
```

After step 2, run Prisma migrations against the managed instance:

```bash
DATABASE_URL="postgresql://codevibe:PASSWORD@<managed-pg-host>:5432/codevibe?sslmode=require" \
  npx prisma migrate deploy
```

## Wiring Next.js to this cluster

Next.js (whatever platform you host it on) needs three URLs:

| Env var | Value |
|---|---|
| `DATABASE_URL` | `postgresql://codevibe:PASSWORD@<prisma-postgres-host>:5432/codevibe` |
| `NEXT_PUBLIC_LANGGRAPH_URL` | `https://<langgraph-api-public-host>` (set via the chart's `ingress`) |
| `NEXT_PUBLIC_WS_URL` | `wss://yjs.codevibe.example.com` (from `50-ingress.example.yaml`) |

If Next.js runs **inside** the same cluster, prefer in-cluster DNS:
- `langgraph-langgraph-cloud.codevibe.svc.cluster.local:8000`
- `yjs-server.codevibe.svc.cluster.local:1234`
- `prisma-postgres.codevibe.svc.cluster.local:5432`

## Notes

- **`yjs-server` runs as a single replica** by design — the in-memory doc
  store in `yjs-server.js` doesn't shard across pods. To horizontally
  scale, swap the in-memory `Map` for the official Hocuspocus Postgres
  extension pointed at `prisma-postgres`.
- **Two Postgres instances** is intentional. The Helm chart's bundled DB
  stores LangGraph checkpoints/threads/runs (high write rate, opaque
  schema, owned by the agent runtime). `prisma-postgres` stores our own
  `Session` schema. Mixing them couples upgrade cycles and makes data
  ownership murky.
- **Production hardening** not done here: NetworkPolicy, PodSecurity
  admission, image pull secrets, HPAs (the chart adds an HPA for
  langgraph-api — tune it via `apiServer.autoscaling`), and managed
  Postgres instead of the in-cluster ones.
