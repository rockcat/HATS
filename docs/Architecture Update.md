# Architecture Update 29 Aug 2026

## Formalise interfaces

1. Create defined json schema for an Agent template definition json file
2. Create a defined schema for a deployed agent - when in a project
3. Create a clean OpenAPI definition for a UI to access teh team runner (see below)

## Architecture

Main system components exist but need to be restructured and separated to some degree

### Agent Template Library

Agent Template Library management and agent template creation will be independant of team deployment
A formal spec for an agent description in JSON is needed and an API for the team runner to access agent definitions
Separate the Agent Template Library code and UI into its own application with a dedicated user interface application - the existing UI code can be taken from the current application

### Project Designer

A small project server will be needed to allow the front end to create /select a project and the an API to provide the project JSON data back and forth
A new UI application to allow the design of a team - pulling agent definitions from the Agent Template Library API and allowing the user to define or edit a project - again most of this code exisst but I want to split it out into its own API and UI then sendign the result to the Project Server

### Team Runner

All functionality as now except for overlap with the elements above which will be removed.
Agent chat interface should remain use the embdiment API
and will now load a project definition from the project server and run the agents. Will now use the prject server to update the project
Add a formal OpenAPI spec for web sites and apps to communicate with it. This is called the 'Embodiment API'

### Embodiment API Test

One new minimal web interface to prove the embodiment api - simple UI for interacting with each agent
