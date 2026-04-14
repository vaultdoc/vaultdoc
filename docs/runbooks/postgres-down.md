---
title: Runbook — PostgreSQL Down
category: runbook
tags:
  - runbook
  - postgres
  - database
  - on-call
updatedAt: '2026-04-14T00:00:00.000Z'
updatedBy: seed
---

## Symptoms

- API returns 500 errors with `ECONNREFUSED` or `connection timeout`
- Grafana alert: `postgres_up == 0`

## Diagnosis

```bash
kubectl get pods -n production -l app=postgres
kubectl logs -n production <pod-name> --tail=100
```

## Recovery

1. Check disk usage — full disk is the #1 cause:
   ```bash
   kubectl exec -n production <pod> -- df -h /var/lib/postgresql
   ```
2. If disk full: clear WAL or extend PVC
3. If pod is crash-looping: `kubectl delete pod <pod>` to trigger reschedule
4. Verify recovery: `kubectl exec -n production <pod> -- pg_isready`

## Escalation

Page the DB lead if not resolved in 10 minutes.
