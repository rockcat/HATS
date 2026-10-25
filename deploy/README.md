# Installing HATS on a new machine

Everything runs from published images, so the machine needs only Docker:
no source checkout, Node, Python or compiler.

## What you need

- **Docker.** Docker Desktop on Windows or Mac; Docker Engine with the compose plugin on Linux.
- **A GitHub personal access token (classic)** with the `read:packages` and `repo` scopes. The images and this repository are private. [Create one](https://github.com/settings/tokens/new?scopes=read:packages,repo).

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

The installer asks for your GitHub username and token, your Anthropic key and an admin password. It then:

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

1. **Export it on the old machine,** from the hats-runner folder:
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
| `ghcr.io/rockcat/hats-runner` | HATS-runner, `.github/workflows/docker.yml` | private |
| `ghcr.io/rockcat/hats-services` | this repository, `.github/workflows/docker.yml` | private |
| `ghcr.io/rockcat/hats-speech` | this repository, `.github/workflows/docker.yml` | private |

Each workflow builds and pushes its images on every push to `main` (tagged `latest`) and on a `v*` tag (tagged with the version).

This repository's workflow checks out HATS-runner, which is private, with the `RUNNER_REPO_TOKEN` Actions secret. That secret is a fine-grained token with Contents: read on HATS-runner; renew it when it expires.

The services images are built against hats-runner's `main`. After changing the shared packages in hats-runner, re-run this repository's workflow from the Actions tab so the services images pick up the change.
