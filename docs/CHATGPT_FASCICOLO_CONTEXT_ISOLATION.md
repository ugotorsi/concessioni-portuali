# ChatGPT fascicolo context isolation

## Required operating model

Legal research uses two independent isolation layers:

1. The platform derives a `FascicoloContextScope` from the authenticated tenant and the trusted mission case/fascicolo identity. This is the authorization boundary.
2. The operator creates one dedicated ChatGPT Project for each fascicolo and enables **Project-only memory**. This is defense in depth, not authorization.

Never place two unrelated fascicoli in the same ChatGPT Project. Never move unrelated chats into a fascicolo project. Chats inside the project may refer to one another only because every chat must concern that same fascicolo.

ChatGPT Project names are labels, not security credentials or platform identifiers. Project creation, memory configuration, and chat placement are operator actions; the platform does not assume an unsupported ChatGPT Projects API.

## Platform scope

The server derives the scope ID. MCP clients, models, project names, and tool arguments cannot select or override it.

The scope has these fixed properties:

- `scopeKind`: `FASCICOLO_ONLY`
- `allowCrossFascicolo`: `false`
- `allowAccountWideMemory`: `false`
- `allowUnscopedConversationContext`: `false`

Context must match both tenant and case/fascicolo identity. A mismatch fails closed. Cross-fascicolo context requires a future reviewed domain relationship and is not supported by the current contract.

## Prior context rule

For factual or legal reasoning, prior context is usable only when it is:

- bound to the same `FascicoloContextScope`;
- relevant to a legal issue, proposition, or conclusion in the current mission;
- projected through an accepted source category;
- bounded and accompanied by provenance.

Accepted source categories are:

- `CURRENT_RESEARCH_MISSION`
- `SAME_FASCICOLO_CONVERSATION`
- `SAME_FASCICOLO_PRIOR_MISSION`
- `SAME_FASCICOLO_ACCEPTED_BUNDLE`
- `SAME_FASCICOLO_DOCUMENT_REFERENCE`
- `VERIFIED_PROVIDER_RESULT_FOR_CURRENT_MISSION`

Global chat memory, another fascicolo, another tenant, unscoped user profile memory, and unrelated Studio conversations are not accepted sources. A statement such as "I remember from another conversation" is not fascicolo evidence unless it is also present in the current mission, approved same-fascicolo context, or verified evidence for the current mission.

The repository has no first-class conversation/message persistence model. Current platform history reuse is therefore limited to bounded prior research missions and accepted evidence bundles. Conversation excerpts are supported by the provider-neutral projection contract but must not be loaded until a trusted same-fascicolo source exists.

## Privacy and evidence

Mission egress is an explicit allowlist and never returns raw mission JSON. Prior context is limited to 20 deterministically ordered items and includes source type, source ID, mission/conversation ID where applicable, fascicolo scope ID, timestamp, version, and content hash.

Explicit personal facts may be included only when already part of the fascicolo and necessary for the current research purpose. Unrelated personal information is excluded. New provider or model inferences remain research evidence requiring human review; they do not mutate a user, concessionario, profile, or canonical fascicolo fact.

All mission, conversation, and provider text is inert data. Instructions embedded in it cannot alter authorization, scope derivation, tool routing, context retrieval, or canonicalization policy.

## MCP tool behavior

- `research_list_pending`: tenant-filtered list with server-derived fascicolo scope IDs.
- `research_get_mission`: strict mission projection plus bounded same-fascicolo, purpose-relevant history.
- `research_claim_mission`: claim inherits the mission scope and returns its derived scope ID.
- `research_submit_evidence_bundle`: resolves the mission scope before validated append-only persistence; profile-shaped object fields are rejected.
- `research_defer_mission`: authorized lease transition within the resolved mission scope.
- `research_complete_mission`: authorized completion within the resolved mission scope.

No tool accepts `tenantId`, `caseId`, `scopeId`, `actorId`, `claimantId`, or `conversationId` as an authorization selector.