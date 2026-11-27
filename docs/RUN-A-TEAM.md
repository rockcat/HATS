# Run a team on your own computer

This page is for you if you just want to use HATS: set up a team of AI agents,
give them work, and watch them get on with it. You don't need to know how to
program, and you don't need to download the source code. An installer sets
everything up, and it all runs in Docker.

It takes about 15 minutes, most of it waiting for downloads.

## What you need

- **A computer running Windows, macOS or Linux.**
- **Docker**, the free tool that runs HATS for you:
  - Windows or Mac: install [Docker Desktop](https://www.docker.com/products/docker-desktop/),
    open it, and leave it running.
  - Linux: install [Docker Engine](https://docs.docker.com/engine/install/)
    with the compose plugin.
- **A key for an AI model**, which is what your agents think with. Any one of:
  - an [Anthropic API key](https://console.anthropic.com/) (Claude), which the
    installer asks for;
  - an OpenAI or Google Gemini key, which you add afterwards (see
    [Adding keys later](#adding-keys-later));
  - a model running on your own computer in Ollama or LM Studio, which needs no key.

  Model providers charge for what your agents use. The dashboard shows what
  each agent is costing you, and you can cap each one's spending per hour.

## 1. Run the installer

### Windows

Open **PowerShell** (search for it in the Start menu) and paste these two lines:

```powershell
irm https://raw.githubusercontent.com/rockcat/HATS/main/deploy/install.ps1 -OutFile install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

### Mac or Linux

Open **Terminal** and paste these two lines:

```bash
curl -fsSL https://raw.githubusercontent.com/rockcat/HATS/main/deploy/install.sh -o install.sh
bash install.sh
```

### What it asks you

1. **Your Anthropic API key.** Paste it, or press Enter to add a key later.
2. **A password for the dashboard.** You'll use it to sign in, so choose one
   and keep it. If you press Enter it will be `changeme`, which you should
   change.

Then it downloads HATS and a set of voices for your agents, starts everything,
and waits until it is ready. This takes a few minutes the first time. When it
says **HATS is running**, it's done.

Everything is kept in one folder: `C:\hats` on Windows, or `hats` in your home
folder on a Mac or Linux. Your keys and password are in a file called `.env`
there, and your team's work is in `data`.

## 2. Sign in

Open **<http://localhost:3001>** in your browser and sign in:

- **Username:** `admin`
- **Password:** the one you chose in the installer

This is your team's dashboard.

## 3. Build your team

A new installation has one agent ready-made, **Claude Code**, which is for
software work. Add the rest of your team:

1. Open **Agents** from the menu on the left, then click **+ Agent**.
2. Give the agent a **name**, a **hat**, an **avatar** (its face in meetings)
   and a **model**.
3. Click **Add Agent**, then repeat for each team member.

The hat is the role the agent takes in a discussion:

| Hat | Its job |
| --- | --- |
| ⚪ White | Facts: what we know, and what we don't |
| 🔴 Red | Feelings: how people will react |
| ⚫ Black | Risks: what could go wrong |
| 🟡 Yellow | Benefits: what could go right |
| 🟢 Green | Ideas: new options and alternatives |
| 🔵 Blue | Process: keeps the discussion on track and sums up |

Three to six agents with different hats make a good first team. A Blue hat is
worth including, since it runs meetings.

Agents you'd like to use again in other projects can be kept in the
**Agent Library**. Click the grid button there to see everyone's faces, and
**+ Add to project** to bring one into this team.

## 4. Put them to work

- **Chat.** Talk to the team, or to one agent, in plain language.
- **Board.** Add tickets for things that need doing. Moving a ticket to
  **In Progress** hands it to the agent it is assigned to, and they start work.
- **Meet.** The **Meet** button on the Agents page starts a meeting. The agents
  talk it through, each with a face and a voice, and you can join in.
- **Requests.** When an agent needs a decision or something only you can give,
  it asks here.
- **Costs.** What each agent has spent.

## Adding keys later

To add an OpenAI, Gemini or other key, or change your password:

1. Open the `.env` file in your HATS folder (`C:\hats\.env` on Windows) in a
   text editor such as Notepad.
2. Put the key after the `=` on its line, for example `OPENAI_API_KEY=sk-...`,
   and save the file.
3. Apply it. In PowerShell or Terminal, go to your HATS folder and run:

   ```text
   docker compose up -d
   ```

   On Windows that's `cd C:\hats` first; on a Mac or Linux, `cd ~/hats`.

To use a model on your own computer, set `OLLAMA_MODEL` or `LM_STUDIO_MODEL`
in `.env` to the name of the model, the same way.

## Everyday use

HATS starts again by itself whenever Docker starts, so after a restart you
only need Docker running. Then open <http://localhost:3001>.

From your HATS folder:

| To | Run |
| --- | --- |
| Stop it | `docker compose stop` |
| Start it again | `docker compose start` |
| Update to the latest version | Run the installer again. Your keys, password and team are kept. |
| Remove it | `docker compose down`, then delete the folder |

## If something goes wrong

**The installer says Docker is not running.** Open Docker Desktop, wait until it
says it is running, and run the installer again.

**The dashboard won't open.** Give it a minute after starting. If it still
won't, see what it's saying from your HATS folder:

```text
docker compose logs hats
```

**Something else is using port 3001.** Another program has taken the address
HATS uses. Close it, or ask whoever looks after your computer for help.

**The agents don't answer.** Usually their model has no key. Check that the
key for the model each agent uses is in `.env`, and that you ran
`docker compose up -d` after adding it.

**The Agent Library shows only Claude Code.** On a new installation that's
expected: it fills up as you add agents. If you had agents there before, click
the refresh button at the top of the library.

## Going further

- [Installing HATS on a new machine](../deploy/README.md): the installer in
  more detail, moving a project from another computer, and staying on one version.
- [Running several teams at once](MULTIPLE-PROJECTS.md).
- [The full guide](README.md): tools, email and calendars, voices and avatars,
  and running HATS from the source code.
