---
title: Deployment Process
category: devops
tags:
  - deploy
  - ci-cd
  - kubernetes
updatedAt: '2026-04-14T00:00:00.000Z'
updatedBy: seed
---

## Overview

All deployments go through the CI/CD pipeline. Direct pushes to production are disabled.

## Steps

1. Open a PR against `main`
2. CI runs tests + lint + docker build
3. After merge, GitHub Actions triggers a rolling deploy to k8s
4. Monitor rollout: `kubectl rollout status deployment/<service> -n production`

## Rollback

```bash
kubectl rollout undo deployment/<service> -n production
```

## Environment Variables

Secrets are stored in Vault and injected via the k8s external-secrets operator.
Never commit secrets to the repo.
