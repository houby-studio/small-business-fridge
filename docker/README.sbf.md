# ⚠️ This image has moved to [`houbystudio/fridgora`](https://hub.docker.com/r/houbystudio/fridgora)

_Small Business Fridge_ is now **Fridgora**. This repository keeps every tag up to **3.2.1** for
rollbacks, but **receives no updates** — new releases, fixes and security patches are published
only as [`houbystudio/fridgora`](https://hub.docker.com/r/houbystudio/fridgora).

## Switching takes one line

In your `compose.yaml`, for both the `app` and the `scheduler` service:

```diff
-    image: houbystudio/sbf:${DOCKER_IMAGE_TAG:-latest}
+    image: houbystudio/fridgora:${DOCKER_IMAGE_TAG:-latest}
```

then `docker compose pull && docker compose up -d`. The database, volumes, `.env`, sessions and
installed kiosks keep working as they are. Details in the
[deployment guide](https://github.com/houby-studio/fridgora/blob/master/docs/deployment.md#moving-from-houbystudiosbf-to-houbystudiofridgora).

Source code: [github.com/houby-studio/fridgora](https://github.com/houby-studio/fridgora)
