# Atlas V80 — Agent Skills Fabric + Operational Pulse

V80 introduces a first-class Agent Skills Fabric. Skills are reusable, versioned capability bundles that constrain which tools an agent may use and what approval level is required.

## Implemented

- tenant-scoped built-in skill catalog
- tenant-defined skill creation
- validation against the live tool registry
- skill-to-agent assignments
- explicit approval metadata for side-effect skills
- deterministic operational pulse
- V80 PostgreSQL migration
- API routes and release documentation

## Security

Skills never grant permissions. They narrow an already-authorized actor/agent capability set. Actual tool invocation still passes Atlas server-side authorization and tenant checks.

## Runtime enforcement

The API boundary resolves active skill assignments before AgentRuntime execution and narrows the effective tool set to the intersection of assigned skills and the agent's configured tools.
