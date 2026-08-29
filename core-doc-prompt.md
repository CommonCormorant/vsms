VSMS Project Archaeology & Directory Documentation

Project

VSMS — Very Simple Message Service

This is a serious project that I am considering reviving.

The purpose of this task is NOT to fix, refactor, modernize, redesign, or otherwise modify VSMS.

The purpose is to help me understand what I already built.

I have been away from this project long enough that opening the source directly is overwhelming. I need a map of the existing system before I start changing anything.

---

Primary Task

Explore the entire VSMS repository and create a Markdown documentation file for every meaningful directory.

Each directory should get a Markdown file explaining what that directory contains and why it appears to exist.

Do not merely list filenames. I need the conceptual purpose of each part of the project.

For example, if the repository looks something like:

vsms/
├── client/
├── server/
│   ├── tf/
│   ├── personality/
│   ├── pdf/
│   └── ...
├── test-results/
└── ...

then each meaningful directory should have its own documentation.

Use an appropriate filename such as:

README.md

or, if a directory already has a README, improve that README rather than creating a competing documentation file.

Do not blindly create documentation for ".git", build caches, temporary files, or other directories that are clearly implementation artifacts rather than project components.

---

What Each Directory Document Should Explain

For each directory, document:

1. Purpose

What is this directory for?

Explain it in ordinary language.

2. Contents

Describe the important files and subdirectories inside it.

Do not produce an enormous mechanical file listing. Focus on files that matter to understanding the project.

3. Role in VSMS

Explain how this directory fits into the larger VSMS architecture.

For example:

- client
- server
- protocol
- message handling
- authentication
- persistence
- testing
- tooling
- AI/personality integration
- static resources
- generated artifacts
- deployment
- etc.

Only describe a role when the source supports that conclusion.

4. Important Code

Identify the important source files and explain what each appears to do.

Include relevant functions, types, handlers, or other architectural elements when useful.

5. Dependencies

Identify important relationships with other directories or components.

For example:

client → server
server → personality data
server → persistence
server → external service

Do not invent relationships. Infer them from imports, configuration, function calls, HTTP routes, filesystem access, etc.

6. Data Flow

Where useful, explain how information moves through the component.

For example:

client
   ↓
HTTP/WebSocket request
   ↓
server handler
   ↓
message processing
   ↓
storage / response
   ↓
client

Again, only document what can be established from the code.

7. Current State

If something appears unfinished, broken, obsolete, experimental, generated, or abandoned, say so.

Use language such as:

- "appears to be"
- "likely"
- "currently"
- "unused"
- "experimental"
- "generated"
- "historical"

when certainty is not possible.

Do not silently turn guesses into facts.

---

VERY IMPORTANT: Do Not Fix Anything

This is an archaeology/documentation pass.

Do NOT:

- modify Go source
- modify JavaScript
- modify HTML/CSS
- change configuration
- change APIs
- change protocols
- rename files
- reorganize directories
- delete files
- refactor code
- upgrade dependencies
- change the database
- change deployment configuration
- rebuild the daemon
- start or stop services
- modify PM2
- modify nginx
- modify production systems
- attempt to repair VSMS

Do not make “helpful” code changes.

If you discover a problem, document it rather than fixing it.

---

Special Attention: Architecture

VSMS is being considered for revival because I like its conceptual design and client better than some of my newer experiments.

Therefore, do not approach this as merely a code-quality review.

I want to recover the idea behind the system.

Try to determine:

- What problem was VSMS intended to solve?
- What does “Very Simple Message Service” mean architecturally?
- What is the client/server relationship?
- What is the communication protocol?
- How are users identified?
- How are messages routed?
- How are conversations represented?
- Where is state stored?
- What is persistent?
- What is ephemeral?
- What does the server daemon actually do?
- What does the client expect from it?
- What assumptions does the system make?
- Which pieces are essential?
- Which pieces appear experimental or incidental?
- What appears to be missing for the system to work today?

---

Do Not Confuse VSMS With Other Projects

There may be files, experiments, test material, AI/personality material, or historical artifacts inside the repository.

Document them accurately, but do not automatically assume they are part of the core VSMS architecture.

In particular, distinguish:

core VSMS

from

experiments / test programs / supporting material / historical artifacts.

If something appears unrelated or only loosely related, explicitly say so.

---

Create a Top-Level Architectural Map

In addition to the directory-level documentation, create:

ARCHITECTURE.md

at the repository root.

This should be the document I read before opening the source code.

It should contain:

VSMS in One Paragraph

Explain what VSMS is in plain English.

The Big Picture

Show the major components and their relationships.

Use a simple ASCII diagram where appropriate.

Example:

             ┌──────────────┐
             │    Client    │
             └──────┬───────┘
                    │
              protocol
                    │
                    ▼
             ┌──────────────┐
             │ VSMS Server  │
             └──────┬───────┘
                    │
             ┌──────┴──────┐
             ▼             ▼
        persistence    message logic

Replace this with the actual architecture discovered in the repository.

Components

Brief explanation of each major component.

Message Lifecycle

Explain what appears to happen when a message is sent.

Identity / Authentication

Explain how users or clients appear to be identified and authenticated.

Persistence

Explain what is stored and where.

Protocol

Explain the relevant HTTP/WebSocket/TCP/etc. protocol details.

Configuration

Explain where configuration comes from.

Running VSMS

Document how the system appears to be intended to run.

Do not actually modify or deploy anything.

If the existing configuration is incomplete or unclear, say so.

Known Problems

Create a section documenting apparent problems discovered during the archaeology pass.

Do not fix them.

Questions / Unknowns

Create a section containing things that cannot confidently be determined from the source.

This section is important.

It is better to say:

«“Unknown — requires further investigation.”»

than to invent an explanation.

---

Create a Revival Starting Point

At the bottom of "ARCHITECTURE.md", create:

Suggested Revival Path

This is NOT a repair plan.

Instead, identify the smallest conceptual path that would let a human developer begin investigating VSMS without becoming overwhelmed.

For example:

1. Understand the server entry point.
2. Understand how the client connects.
3. Understand one complete message flow.
4. Identify why the current daemon fails.
5. Establish a minimal client → server → response path.
6. Only then investigate secondary features.

Adapt this to the actual VSMS architecture.

The purpose is to give me a place to start, not a giant TODO list.

---

Documentation Style

Write for the project's original developer returning to the project after a long absence.

Be:

- clear
- concise
- technical when necessary
- explanatory
- honest about uncertainty

Do not write corporate documentation.

Do not pad the documents with generic statements such as “this directory contains important files.”

Tell me why the files matter.

The goal is that I can read:

ARCHITECTURE.md

and then say:

«“Okay. I remember what I was doing.”»

before touching the code.

---

Final Requirement

When finished, provide a concise summary of:

1. The major VSMS components discovered.
2. The apparent architecture.
3. The most important unknowns.
4. The apparent reasons VSMS may currently fail.
5. The recommended first place for a human developer to investigate.

Again:

Do not fix anything.

The deliverable is a map of the existing system.

We are trying to make VSMS understandable again before we make it work again.
