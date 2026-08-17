# Flutter app requirements

The primary goal of the flutter app is tp provide a single source app which can be deployed on mobile devices.
As a Flutter app it can also work on PCs but taht is not the primary target.

## App functionality

The app is intended to provide fast access and interaction with a single HATS team, allowing the user to quickly type or speak messages to a team member and see adn/or hear responses.

## User flows

### First time start

1. User must login in by scanning a QR code from the web application - thiw will provide a url which when accessedd will deliver a unique API key.
2. User choooses which of their projects they want to use - if they have none they are told to use the web application to set one up first

The spec for returned data from QR code link is:

200 OK — success:

```json
{
  "ok": true,
  "username": "admin",
  "apiKey": "<raw key string>",
  "keyId": "<key id>"
}
```

410 Gone — expired or invalid token:

```json
{ "error": "Pairing link has expired or is invalid" }
```

404 — user deleted since QR was generated:

```json
{ "error": "User not found" }
```

### Normal start

1. connect to server and display first agent - use 3d avatar
2. user can swipe left or rigtht to switch between agents on the project
3. bottom 30% of display is chat window - user can type or press mic to speak
4. agent response is shown

### other features

1. Hamburger menu containing:
   - Project : takes user to a screen to change project
   - Kanban : Screen showing current tasks as a list filterable by state
   - Logout : deletes API key and resets state





