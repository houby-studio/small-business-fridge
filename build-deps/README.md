# Overview

This image serves as a "owned" layer for reproducable builds of main small-business-fridge image.

## Updating

```powershell
cd ./build-deps
docker build -t houbystudio/base-small-business-fridge:$(Get-Date -Format "yyyy-MM-dd") .
docker push houbystudio/base-small-business-fridge:$(Get-Date -Format "yyyy-MM-dd")
```

## Using

Replace for both build and production hosting in main Dockerfile.
