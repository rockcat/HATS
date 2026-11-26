# Installing HATS on a new machine

Everything runs from published images, so the machine needs only Docker:
no source checkout, Node, Python or compiler.

## What you need

- **Docker.** Docker Desktop on Windows or Mac; Docker Engine with the compose plugin on Linux.

That's all. The repository and images are public, so no GitHub account is needed.

## Install

Download `install.ps1` (Windows) or `install.sh` (Linux/Mac) from this folder on GitHub, then run it.

Windows:
```
powershell -ExecutionPolicy Bypass -File install.ps1
```

Linux or Mac:
```
bash install.sh
```

The installer asks for your Anthropic key and an admin password. It then:

1. creates the installation folder, `C:\hats` or `~/hats`;
2. downloads voices and the images;
3. starts everything, and waits until the runner answers.

The dashboard is then at http://localhost:3001.

The installation folder ends up like this:

```
hats/
  docker-compose.yml   from this folder; replaced on each install
  .env                 your keys and passwords; never replaced
  data/                everything the installation keeps
```

To add other API keys later, edit `.env`, then run `docker compose up -d` in that folder.

## Moving a project in

1. **Export it on the old machine,** from the HATS folder:
   ```
   node --env-file=.env scripts/project-transfer.mjs export paige --credentials
   ```
   `--credentials` includes the agents' mail and calendar logins. Leave it out to set those up again by hand.
2. **Copy the zip into `data/`** on the new machine.
3. **Import it:**
   ```
   docker compose exec hats node scripts/project-transfer.mjs import /app/runtime_data/paige.hats.zip
   ```
   The import lists any voices the project's agents use that aren't installed. Fetch them by running the installer again with those voices:
   - Windows: `-Voices en_GB-alba-medium`
   - Linux/Mac: `HATS_VOICES="en_GB-alba-medium"`
4. **Delete the zip** once it's imported, if it included credentials.

## Updating

Run the installer again. It fetches the current compose file and images and restarts the containers. Your `.env` and `data/` are left alone.

To stay on one release, set `HATS_VERSION=0.1.3` in `.env`. The default is `latest`.

## Images

| Image | Built from | Visibility |
|---|---|---|
| `ghcr.io/rockcat/hats/runner` | `Dockerfile` | public |
| `ghcr.io/rockcat/hats/services` | `Dockerfile.services`, target `services` | public |
| `ghcr.io/rockcat/hats/speech` | `Dockerfile.services`, target `speech` | public |

`.github/workflows/docker.yml` builds and pushes all three on every push to `main` (tagged `latest`) and on a `v*` tag (tagged with the version). They come from one checkout, so a change to a shared package reaches every image in the same build.
