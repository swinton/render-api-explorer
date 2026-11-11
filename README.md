# Render API Explorer

Explore Render's API in [Yaak](https://yaak.app), starting with **Build Reuse**: build a Git repository once and deploy that build to multiple services.

[![Run in Yaak](https://yaak.app/static/button.svg)](https://yaak.app/button/run?name=Render%20Build%20Reuse&url=https%3A%2F%2Fraw.githubusercontent.com%2Fswinton%2Frender-api-explorer%2Fmain%2Fcollections%2Fbuild-reuse.yaak.json)

Click **Run in Yaak** to import the Build Reuse collection. You can also clone this repository and import the local file below.

Build Reuse is in [limited early access](https://render.com/docs/build-reuse). Your Render workspace needs access, and the API may change. This community project is not affiliated with Render or Yaak.

## Get started

1. Install Yaak. Open **Import Data**, select [`collections/build-reuse.yaak.json`](collections/build-reuse.yaak.json), and preview the import into a new workspace.
2. Create a private sub-environment in Yaak. Set `renderApiKey` to your [Render API key](https://render.com/docs/api). Keep this environment private (not sharable).
3. Set the variables below in that private environment. The global environment contains editable examples, including `node`, `main`, and `oregon`; change them to match your services.
4. Open **01 · Share one Git build** and send its requests individually, in order. Start with the read-only requests to find and inspect your services.

| Variable | What to enter |
| --- | --- |
| `ownerId` | Render workspace owner ID |
| `repoUrl` | Git repository URL; connect private repositories to Render first |
| `branch` | Branch to build |
| `runtime` | `docker`, `elixir`, `go`, `node`, `python`, `ruby`, or `rust` |
| `region` | Region shared by the build source and both services |
| `buildCommand` | Your repository's build command; edit the body for Docker-specific settings |
| `serviceAId`, `serviceBId` | Two existing supported service IDs |
| `buildSourceName` | A name for your shared build source |
| `buildSourceId` | Set after creating the source, using the response's `id` |
| `buildId` | Set after triggering a build, using the response's `id`, **not** `buildRun.id` |

Authentication is configured once on the workspace and inherited by requests. Requests use Yaak variables such as `${[ buildSourceId ]}`. No credential is included in this repository.

## Share one Git build across two existing services

The first walkthrough assumes you have two web services, private services, or background workers. They must belong to the same workspace and region. Cron jobs and static sites are not supported by Build Reuse. See [Render's current limitations](https://render.com/docs/build-reuse#current-limitations).

1. **Find and inspect the services.** Record their current repository, branch, runtime, build command, start command, and auto-deploy configuration before changing them. Confirm that both can run the same built artifact. Each service retains its own runtime configuration.
2. **Create a Git build source.** Edit the request body before sending. The API field for the Git URL is `git.repoUrl`. For monorepos or Docker builds, add the appropriate `rootDir`, `dockerfilePath`, or `dockerContext` fields using the [create endpoint reference](https://api-docs.render.com/reference/create-build-source). Copy the returned `id` into `buildSourceId`. A source's region cannot be changed after creation.
3. **Configure its build environment.** Use the reference folders to add any required environment variables, secret files, or environment groups before linking services. Build-time and runtime variables are separate: values needed in both places must be configured in both places. Bulk PUT requests replace all entries, so retrieve existing values first.
4. **Link services A and B.** Each PATCH sends only `buildSourceId` and replaces that service's build configuration with the source's. For native runtimes, the service needs an existing start command; if absent, add `serviceDetails: { "startCommand": "YOUR_COMMAND" }` to its linking body. Docker sources reject a start command. See [update service](https://api-docs.render.com/reference/update-service).
5. **Trigger the shared build.** This explicitly starts a new build and can deploy it to linked services with auto-deploy enabled. API updates to the source or its build environment require an explicit trigger. Copy the returned build `id` into `buildId`.
6. **Check the build.** Repeat the status request manually until `buildRun.status` is `succeeded`. Investigate failures in Render before deploying.
7. **Deploy and verify.** If auto-deploy already deployed the build, skip the manual deploy requests. Otherwise, send the deploy request for each service with the same `buildId`. Inspect deploy status and verify both services in Render.

The walkthrough is intentionally manual: you choose when to create, link, build, and deploy. Sending the whole folder at once does not wait for a successful build or fill in the returned IDs.

To unlink a service, restore its own repository or image build configuration using Render's documented procedure. To delete a build source, unlink every service first. See [Build Reuse](https://render.com/docs/build-reuse).

## Included API reference

The reference folders include every `/build-sources` operation in the pinned Render specification:

- Create, list, retrieve, update, and delete build sources
- Trigger, list, and retrieve builds
- List, replace, retrieve, add/update, and delete build environment variables and secret files
- Link and unlink environment groups
- Supporting requests to list/retrieve services, link an existing service, and trigger/list deploys

The reference requests use `serviceId` independently of the walkthrough's `serviceAId` and `serviceBId`. Optional query parameters are included but disabled, except the workspace filter and page limit. For pagination, copy the last item's cursor into `cursor` and enable the cursor parameter. Reference request bodies are editable templates; review them before sending, especially replacement and deletion requests.

This is the first API collection. Coverage of the rest of Render's API can be added incrementally.

## Development

Requires Node.js 22 or later. There are no package dependencies. Generation and tests are offline and do not contact Render.

```sh
npm run generate
npm test
npm run check
```

`upstream/render-openapi.json` is a pinned copy of [Render's published OpenAPI specification](https://api-docs.render.com/docs/api-spec). `upstream/source.json` records its URL, retrieval time, and SHA-256 hash. The generator selects Build Reuse operations and adds the guided workflow, stable import IDs, shared authentication, and placeholder variables. The output is a native Yaak schema 5 JSON import.

To refresh the upstream snapshot:

```sh
npm run update:spec
npm run generate
npm test
npm run check
```

Review the upstream and generated diffs together before merging. Render's spec is not versioned, and early-access APIs may change. Keep updates in pull requests rather than automatically publishing changed collections.

For a release, import the generated file in Yaak, confirm the preview, check credential inheritance and variable rendering, then exercise the walkthrough in a beta-enabled test workspace. Automated checks cover generation, endpoint coverage, local references, and workflow contracts; they do not prove live API behavior.

## Contributing and credits

Changes to request generation belong in `scripts/generate.mjs`; regenerate the collection in the same PR. Include the relevant Render API documentation and describe any live validation. Keep credentials, private repository URLs, service IDs, and captured responses out of contributions.

Inspired by [swinton/github-rest-apis-for-insomnia](https://github.com/swinton/github-rest-apis-for-insomnia). Uses [Render's OpenAPI specification](https://api-docs.render.com/docs/api-spec) and Yaak's [native import format](https://github.com/mountain-loop/yaak/tree/main/plugins/importer-yaak). Original code and documentation are [ISC licensed](LICENSE); the upstream snapshot is supplied by Render.
