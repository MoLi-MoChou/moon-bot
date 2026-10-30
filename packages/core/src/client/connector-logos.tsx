import { createElement as h } from 'react'
import type { ReactElement } from 'react'

export interface LogoProps {
  size?: number
}

const pathIcon = (paths: readonly string[], opacities?: readonly number[]) =>
  function PathIcon({ size = 20 }: LogoProps) {
    return (
      <svg width={size} height={size} viewBox='0 0 24 24' aria-hidden fill='currentColor'>
        {paths.map((d, i) => (
          <path key={i} d={d} opacity={opacities?.[i] ?? 1} />
        ))}
      </svg>
    )
  }

const strokeIcon = (paths: readonly string[], strokeWidth = 1.8) =>
  function StrokeIcon({ size = 20 }: LogoProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox='0 0 24 24'
        aria-hidden
        fill='none'
        stroke='currentColor'
        strokeWidth={strokeWidth}
        strokeLinecap='round'
        strokeLinejoin='round'>
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
    )
  }

// Developer tools
export const GitHubLogo = pathIcon([
  'M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z',
])
export const GitLabLogo = pathIcon(
  [
    'M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l2.42-7.44a.84.84 0 0 1 1.6-.03l1.83 5.61h10.2l1.83-5.61a.84.84 0 0 1 1.6.03l2.42 7.44a.84.84 0 0 1-.3.94z',
    'M12 22.13l-5.1-10.51h10.2L12 22.13z',
    'M12 22.13l-5.1-10.51H1.05l10.95 10.51z',
    'M12 22.13l5.1-10.51h5.85L12 22.13z',
  ],
  [0.7, 1, 0.85, 0.85],
)
export const GitLogo = strokeIcon([
  'M3 12h4l3 9 4-18 3 9h4',
  'M5 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
  'M19 22a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
])
export const DockerLogo = pathIcon([
  'M13.98 4.77h2.24v2.09h-2.24V4.77zm-3.04 0h2.24v2.09h-2.24V4.77zm-3.04 0h2.24v2.09H7.9V4.77zm6.08 2.87h2.24v2.09h-2.24V7.64zm-3.04 0h2.24v2.09h-2.24V7.64zm-3.04 0h2.24v2.09H7.9V7.64zm-3.04 0h2.24v2.09H4.86V7.64zm9.12 2.87h2.24v2.09h-2.24v-2.09zm-3.04 0h2.24v2.09h-2.24v-2.09zm-3.04 0h2.24v2.09H7.9v-2.09zm-3.04 0h2.24v2.09H4.86v-2.09zm-3.04 0h2.24v2.09H1.82v-2.09zM22.9 11.6c-.36-.26-1.18-.32-1.78-.18-.1-.4-.36-.75-.72-1-.87-.6-2.07-.46-2.88.22-.53-.12-1.18-.1-1.74.05-1.07.29-1.92 1.05-2.26 2.05H1.2c-.44 0-.8.36-.8.8 0 3.82 2.44 7.21 6.08 8.42 4.45 1.48 9.27.38 12.65-2.9 2.08-2.02 3.12-4.78 3.77-7.46z',
])
export const KubernetesLogo = pathIcon([
  'M12 2L3.5 7v10L12 22l8.5-5V7L12 2zm0 3.2l6.2 3.6v7.4L12 19.8 5.8 16.2V8.8L12 5.2zm-1 3.8v6h2v-6h-2z',
])
export const SentryLogo = pathIcon([
  'M13.11 3.26a10.05 10.05 0 0 0-7.39 3.09l1.6 1.6a7.78 7.78 0 0 1 5.79-2.42c4.32 0 7.82 3.5 7.82 7.82a7.77 7.77 0 0 1-3.23 6.34l1.58 1.62A10.04 10.04 0 0 0 23.18 13.35c0-5.58-4.5-10.09-10.07-10.09zM4.12 7.95a10.05 10.05 0 0 0-3.3 5.4c0 5.58 4.5 10.09 10.07 10.09a10.05 10.05 0 0 0 7.39-3.09l-1.6-1.6a7.78 7.78 0 0 1-5.79 2.42c-4.32 0-7.82-3.5-7.82-7.82a7.77 7.77 0 0 1 3.23-6.34L4.12 7.95zm5.55 1.72a5.52 5.52 0 0 0-1.8 4.08c0 3.06 2.46 5.52 5.52 5.52a5.52 5.52 0 0 0 4.08-1.8l-1.6-1.6a3.26 3.26 0 0 1-2.48 1.14c-1.8 0-3.26-1.46-3.26-3.26a3.26 3.26 0 0 1 1.14-2.48l-1.6-1.6z',
])
export const PlaywrightLogo = pathIcon(
  [
    'M17.5 4.5c-3.5 0-6.5 2.8-6.5 6.3 0 2.2 1.1 4.1 2.8 5.2l-.8 3.5 3.3-1.4c.4.1.8.2 1.2.2 3.5 0 6.5-2.8 6.5-6.3 0-4.2-3-7.5-6.5-7.5zm-1.8 5.8a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm3.6 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z',
    'M6.5 7.5C3 7.5 0 10.8 0 15c0 3.5 3 6.3 6.5 6.3.4 0 .8-.1 1.2-.2l3.3 1.4-.8-3.5c1.7-1.1 2.8-3 2.8-5.2 0-3.5-3-6.3-6.5-6.3zm-1.8 5.8a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm3.6 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z',
  ],
  [1, 0.7],
)
export const PuppeteerLogo = pathIcon([
  'M12 2a2 2 0 0 0-2 2v1.1A7 7 0 0 0 5 12a7 7 0 0 0 7 7 7 7 0 0 0 7-7 7 7 0 0 0-5-6.9V4a2 2 0 0 0-2-2zm-5 10a5 5 0 0 1 4-4.9V11a1 1 0 0 0 2 0V7.1A5 5 0 0 1 17 12a5 5 0 0 1-5 5 5 5 0 0 1-5-5zm5-9a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
])
export const DatadogLogo = pathIcon([
  'M12 3a9 9 0 0 0-9 9c0 4.1 2.8 7.6 6.6 8.7l.4-2.3A6.8 6.8 0 0 1 5.3 12a6.7 6.7 0 1 1 11.4 4.8l2.1 1A9 9 0 0 0 12 3zm-2 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm4 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
])
export const GrafanaLogo = strokeIcon([
  'M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9zm0 4a5 5 0 1 1-5 5 5 5 0 0 1 5-5zm0 3a2 2 0 1 0 2 2 2 2 0 0 0-2-2z',
])
export const PostmanLogo = pathIcon([
  'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm1 14.8V15h-2v1.8c-2.8-.4-5-2.6-5.4-5.4H7v-2h-1.4c.4-2.8 2.6-5 5.4-5.4V6h2v-1.8c2.8.4 5 2.6 5.4 5.4H17v2h1.4c-.4 2.8-2.6 5-5.4 5.4z',
])
export const TerraformLogo = pathIcon([
  'M1.5 2.5l7 4v8l-7-4v-8zm8 4.6l7-4v8l-7 4v-8zm7-4l6 3.5v7l-6-3.5v-7zm-7 12.6l7-4v7.8l-7 4v-7.8z',
])

// Search & web
export const BraveLogo = pathIcon([
  'M12 2l7.5 3.5v6.2c0 5.4-3.5 10-7.5 11.3C8 21.7 4.5 17.1 4.5 11.7V5.5L12 2zm0 3.2L6.5 7.8v3.9c0 4.1 2.5 7.8 5.5 8.9 3-1.1 5.5-4.8 5.5-8.9V7.8L12 5.2zm-2.5 5.3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
])
export const TavilyLogo = strokeIcon(['M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z'])
export const ExaLogo = pathIcon(['M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm-1 5h2v6h-2zm0 8h2v2h-2z'])
export const PerplexityLogo = strokeIcon(['M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4'])
export const GoogleLogo = pathIcon([
  'M12 4.5c2.4 0 4.1 1 5 1.9l3.4-3.4C18.3 1.1 15.4 0 12 0 7.4 0 3.4 2.6 1.4 6.4l4 3.1C6.4 6.8 8.9 4.5 12 4.5zm11.7 7.7c0-.8-.1-1.6-.2-2.2H12v4.4h6.6c-.3 1.6-1.2 3-2.5 3.9l4 3.1c2.4-2.2 3.6-5.4 3.6-9.2zM5.4 14.5c-.2-.7-.4-1.5-.4-2.5s.1-1.8.4-2.5L1.4 6.4C.5 8.1 0 10 0 12s.5 3.9 1.4 5.6l4-3.1zM12 24c3.4 0 6.3-1.1 8.4-3.1l-4-3.1c-1.1.8-2.6 1.3-4.4 1.3-3.1 0-5.7-2.1-6.6-5l-4 3.1C3.4 21.4 7.4 24 12 24z',
])
export const BingLogo = pathIcon(['M4 2v19l6.5 3 9.5-5.5v-7L12 8l-2 1v-7H4z'])
export const DuckLogo = pathIcon([
  'M12 2a10 10 0 0 0-8.7 15c.6.9 1.7 1.5 2.7 1.2l3-1.2 3 3 6-6c1.3-2.1 1.5-4.7.5-7A9.9 9.9 0 0 0 12 2zm-2 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
])
export const JinaLogo = strokeIcon(['M4 4h16v16H4V4zm4 4h8M8 12h8M8 16h5'])
export const FirecrawlLogo = strokeIcon(['M12 2c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10zm-1 8a2 2 0 0 0 2 2'])
export const FetchLogo = strokeIcon([
  'M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9zm-8.4 9h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
])

// Productivity & Docs
export const SlackLogo = pathIcon(
  [
    'M5 14.5a2.5 2.5 0 0 1 2.5-2.5h2.5v2.5a2.5 2.5 0 0 1-5 0z',
    'M11.5 14.5a2.5 2.5 0 0 1-2.5-2.5V7a2.5 2.5 0 0 1 5 0v5a2.5 2.5 0 0 1-2.5 2.5z',
    'M9.5 5a2.5 2.5 0 0 1 2.5 2.5v2.5H9.5a2.5 2.5 0 0 1 0-5z',
    'M9.5 11.5a2.5 2.5 0 0 1 2.5-2.5H17a2.5 2.5 0 0 1 0 5h-5a2.5 2.5 0 0 1-2.5-2.5z',
  ],
  [0.7, 0.7, 1, 1],
)
export const NotionLogo = pathIcon([
  'M4.46 3.65l13.14-2.6a1.5 1.5 0 0 1 1.77 1.27l1.91 14.88a1.5 1.5 0 0 1-1.28 1.76l-13.14 2.6A1.5 1.5 0 0 1 5.09 20.3L3.18 5.42a1.5 1.5 0 0 1 1.28-1.77zM7.8 7.3v9.8l2.1-.3V10.2l4.8 6.5 2.3-.3V7.1l-2 .3v6.3l-4.7-6.4H7.8z',
])
export const LinearLogo = pathIcon([
  'M3.05 13.78a8.96 8.96 0 0 1 7.17-10.73 1.5 1.5 0 0 1 1.74 1.18 1.5 1.5 0 0 1-1.18 1.74 5.96 5.96 0 0 0-4.77 7.13 5.96 5.96 0 0 0 7.13 4.77 1.5 1.5 0 0 1 1.74 1.18 1.5 1.5 0 0 1-1.18 1.74 8.96 8.96 0 0 1-10.65-7.01z',
  'M14.5 4.5l5 5-9.5 9.5-5-5 9.5-9.5z',
])
export const JiraLogo = pathIcon([
  'M11.5 2.5a9.5 9.5 0 0 1 9.5 9.5h-5a4.5 4.5 0 0 0-4.5-4.5v-5zm-5 5A9.5 9.5 0 0 1 16 17h-5a4.5 4.5 0 0 0-4.5-4.5v-5z',
])
export const ConfluenceLogo = pathIcon([
  'M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6zm4 4l5 4 5-4v4l-5 4-5-4v-4z',
])
export const GoogleDriveLogo = pathIcon(
  [
    'M8.07 19.5L2.83 10.42L6.87 3.42L12.11 12.5L8.07 19.5Z',
    'M15.93 19.5H8.07L12.11 12.5H19.97L15.93 19.5Z',
    'M19.97 12.5L15.93 19.5L10.69 10.42L14.73 3.42H22.01L19.97 12.5Z',
  ],
  [0.6, 0.8, 1],
)
export const CalendarLogo = strokeIcon(['M3 5h18v15H3V5zm0 5h18M7 3v4M17 3v4'])
export const ObsidianLogo = pathIcon(['M12 2l7 4-3 14-8 2-5-6 9-14zm-1 4.5L6 14l5 3 4-8-4-2.5z'])
export const AirtableLogo = pathIcon(['M12 3L2 8l10 5 10-5-10-5zm-8 7.5v6.5l8 4v-6.5l-8-4zm16 0l-8 4v6.5l8-4v-6.5z'])
export const TrelloLogo = pathIcon(['M3 4h18v16H3V4zm3 3h4v9H6V7zm8 0h4v6h-4V7z'])
export const AsanaLogo = pathIcon([
  'M12 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm-6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm12 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
])
export const Context7Logo = pathIcon([
  'M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4zm2 0v16h10V4H7zm2 3h6v2H9V7zm0 4h6v2H9v-2zm0 4h4v2H9v-2z',
])

// Data & Databases
export const PostgresLogo = pathIcon([
  'M12 2C6.48 2 2 6.48 2 12c0 3.7 2.01 6.94 5 8.65V18c0-1.1.9-2 2-2h1v-2H9c-1.1 0-2-.9-2-2v-2c0-1.1.9-2 2-2h1.5C11.5 6.5 13 5 15 5c1.66 0 3 1.34 3 3v2h1c1.1 0 2 .9 2 2v1c0 1.1-.9 2-2 2h-1v1.5c1.86-1.5 3-3.8 3-6.5 0-5.52-4.48-10-10-10zm-1 8h-1V9h1v1zm4 0h-1V9h1v1zm-2 4h-2v-1.5h2V14z',
])
export const MySqlLogo = pathIcon([
  'M12 3a9 9 0 0 0-9 9c0 3.2 1.7 6 4.3 7.6L9 15c-1.1-.3-2-1.3-2-2.5a2.5 2.5 0 0 1 5 0c0 1.2-.9 2.2-2 2.5l1.7 4.6A9 9 0 0 0 21 12a9 9 0 0 0-9-9z',
])
export const SqliteLogo = strokeIcon([
  'M4 6c0 1.7 3.6 3 8 3s8-1.3 8-3-3.6-3-8-3-8 1.3-8 3zm0 6c0 1.7 3.6 3 8 3s8-1.3 8-3M4 18c0 1.7 3.6 3 8 3s8-1.3 8-3M4 6v12M20 6v12',
])
export const RedisLogo = pathIcon(['M12 3L2 8l10 5 10-5-10-5zm0 7l-8-4v3l8 4 8-4V6l-8 4zm0 5l-8-4v3l8 4 8-4v-3l-8 4z'])
export const MongoLogo = pathIcon(['M12 2C10 5 7 8 7 13a5 5 0 0 0 10 0c0-5-3-8-5-11zm0 18v-4h1v4h-1z'])
export const ElasticLogo = strokeIcon([
  'M12 4a8 8 0 1 0 8 8 8 8 0 0 0-8-8zm0 5a3 3 0 1 0 3 3 3 3 0 0 0-3-3z',
  'M12 2v4M12 18v4M2 12h4M18 12h4',
])
export const ClickHouseLogo = pathIcon(['M3 6h3v12H3V6zm5-2h3v16H8V4zm5 4h3v8h-3V8zm5-4h3v16h-3V4z'])
export const SnowflakeLogo = strokeIcon([
  'M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1M10 6l2-2 2 2M10 18l2 2 2-2',
])
export const SupabaseLogo = pathIcon(['M12 2L3 14h7v8l9-12h-7V2z'])
export const FilesystemLogo = pathIcon([
  'M3 6a2 2 0 0 1 2-2h4.5a2 2 0 0 1 1.4.6L12.4 6H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6zm2 2v10h14V8h-7.1l-1.5-1.4A1 1 0 0 0 9.7 6H5v2z',
])

// Cloud & Infrastructure
export const CloudflareLogo = pathIcon([
  'M18.5 10a4.5 4.5 0 0 0-8.7-1.3A5.5 5.5 0 0 0 4.5 14H19a3 3 0 0 0-.5-4z',
  'M6 16h14a2 2 0 0 0 0-4H19',
])
export const AwsLogo = pathIcon([
  'M12 4a8 8 0 0 0-8 8c0 3.2 1.9 6 4.6 7.3l1-1.8A6 6 0 1 1 18 12h2a8 8 0 0 0-8-8zm-5 13c3 2 7 2 10 0l.8 1.8c-3.6 2.4-8 2.4-11.6 0l.8-1.8z',
])
export const VercelLogo = pathIcon(['M12 2L24 22H0L12 2z'])
export const NeonLogo = pathIcon(['M4 4h4l8 12V4h4v16h-4L8 8v12H4V4z'])
export const GcpLogo = pathIcon([
  'M12 4a6 6 0 0 0-5.7 4.1A5 5 0 0 0 2 13a5 5 0 0 0 5 5h10a5 5 0 0 0 5-5c0-2.3-1.6-4.3-3.8-4.8A6 6 0 0 0 12 4z',
])
export const AzureLogo = pathIcon(['M13.5 2.5L5 17h5.5l3-5.5 5 10H24L13.5 2.5zM2 21.5h10l-3-5.5H5.5L2 21.5z'])
export const DigitalOceanLogo = pathIcon([
  'M12 2a10 10 0 0 0-10 10h4a6 6 0 1 1 6 6v4a10 10 0 0 0 0-20zm-5 13h3v3H7v-3zm0 4h3v3H7v-3zm-4-4h3v3H3v-3z',
])
export const QdrantLogo = strokeIcon(['M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zm0 5l4 2.3v4.4L12 17l-4-2.3V10.3L12 8z'])

// Communication & Social
export const DiscordLogo = pathIcon([
  'M19.3 5.3A15.8 15.8 0 0 0 15.5 4a11.2 11.2 0 0 0-.5 1.1 14.7 14.7 0 0 0-6 0c-.2-.4-.3-.8-.5-1.1A15.8 15.8 0 0 0 4.7 5.3C2.2 9 1.5 12.6 1.8 16.2a15.9 15.9 0 0 0 4.9 2.5c.4-.5.7-1.1 1-1.7-.8-.3-1.5-.7-2.2-1.2.2.1.4.3.5.4 3 1.4 6.2 1.4 9.2 0 .2-.1.4-.3.5-.4-.7.5-1.4.9-2.2 1.2.3.6.6 1.2 1 1.7a15.9 15.9 0 0 0 4.9-2.5c.5-4.2-.8-7.8-2.6-10.9zM8.5 14c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z',
])
export const TelegramLogo = pathIcon([
  'M21.5 3.5L2.5 11l5.5 2 2 6 3-3.5 5 4 3.5-16zM8.8 12.5l8.7-6.2-7 7.5-.2 2.7-1.5-4z',
])
export const TwitterLogo = pathIcon([
  'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
])
export const RedditLogo = pathIcon([
  'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm6 11a2 2 0 0 1-2 2 5.5 5.5 0 0 1-8 0 2 2 0 0 1-2-2 2 2 0 0 1 3.4-1.4 5.3 5.3 0 0 1 5.2 0A2 2 0 0 1 18 13zm-8.5-1a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm5 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
])
export const YoutubeLogo = pathIcon([
  'M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5a2.7 2.7 0 0 0-1.9 1.9C2 8.9 2 12 2 12s0 3.1.4 4.8a2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9c.4-1.7.4-4.8.4-4.8s0-3.1-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z',
])
export const SpotifyLogo = pathIcon([
  'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm4.6 14.4a.6.6 0 0 1-.9.2c-2.4-1.5-5.5-1.8-9.1-1a.6.6 0 0 1-.3-1.2c4-.9 7.3-.6 10.1 1.1a.6.6 0 0 1 .2.9zm1.2-2.7a.8.8 0 0 1-1.1.3c-2.8-1.7-7-2.2-10.3-1.2a.8.8 0 0 1-.5-1.5c3.8-1.2 8.4-.6 11.6 1.4a.8.8 0 0 1 .3 1zm.1-2.9C14.5 9 8.5 8.8 5 9.8a1 1 0 1 1-.6-1.9c4.1-1.2 10.7-1 14.7 1.4a1 1 0 0 1-1.2 1.5z',
])
export const TwilioLogo = pathIcon([
  'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm-3 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm6 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm-6 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm6 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
])
export const SendGridLogo = pathIcon(['M3 6h7v7H3V6zm11 0h7v7h-7V6zm-11 11h7v7H3v-7zm11 0h7v7h-7v-7z'])

// AI & Intelligence
export const KnowledgeGraphLogo = strokeIcon([
  'M6 6m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  'M18 7m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  'M14 18m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  'M8.5 7.5l7 0',
  'M8 8l4.5 7.5',
  'M16 9.5l-1.5 5.5',
])
export const SequentialThinkingLogo = strokeIcon([
  'M9.5 2a4.5 4.5 0 0 0-4.5 4.5c0 .9.3 1.8.8 2.5a5.5 5.5 0 0 0-.8 8.5L7 19v3h10v-3l2-1.5a5.5 5.5 0 0 0-.8-8.5c.5-.7.8-1.6.8-2.5A4.5 4.5 0 0 0 14.5 2h-5z',
  'M9 13h6',
  'M10 17h4',
  'M12 7v3',
])
export const TimeLogo = strokeIcon(['M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 4v6l4 2'])
export const EverythingLogo = strokeIcon(['M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z'])
export const WikipediaLogo = pathIcon([
  'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm2.5 13.5l-2.5-6.5-2.5 6.5H8l3.2-8.5h1.6l3.2 8.5h-1.5z',
])
export const ArxivLogo = strokeIcon(['M4 4v16h16V4H4zm4 4l8 8M16 8l-8 8'])
export const WolframLogo = pathIcon(['M12 2l3 5 5-2-1 6 5 3-4 4 2 5-6-1-3 5-3-5-6 1 2-5-4-4 5-3-1-6 5 2 3-5z'])
export const WeatherLogo = strokeIcon([
  'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M7 16a4 4 0 0 1 7.7-1.5A3 3 0 1 1 18 18H7z',
])
export const DefaultConnectorLogo = strokeIcon([
  'M12 2v6M12 16v6M2 12h6M16 12h6',
  'M12 12m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
])

export const CONNECTOR_LOGOS: Record<string, (props: LogoProps) => ReactElement> = {
  github: GitHubLogo,
  gitlab: GitLabLogo,
  git: GitLogo,
  docker: DockerLogo,
  kubernetes: KubernetesLogo,
  sentry: SentryLogo,
  playwright: PlaywrightLogo,
  puppeteer: PuppeteerLogo,
  datadog: DatadogLogo,
  grafana: GrafanaLogo,
  postman: PostmanLogo,
  terraform: TerraformLogo,
  'brave-search': BraveLogo,
  tavily: TavilyLogo,
  exa: ExaLogo,
  perplexity: PerplexityLogo,
  'google-search': GoogleLogo,
  'bing-search': BingLogo,
  duckduckgo: DuckLogo,
  jina: JinaLogo,
  firecrawl: FirecrawlLogo,
  'web-fetch': FetchLogo,
  slack: SlackLogo,
  notion: NotionLogo,
  linear: LinearLogo,
  jira: JiraLogo,
  confluence: ConfluenceLogo,
  'google-drive': GoogleDriveLogo,
  'google-calendar': CalendarLogo,
  obsidian: ObsidianLogo,
  airtable: AirtableLogo,
  trello: TrelloLogo,
  asana: AsanaLogo,
  context7: Context7Logo,
  postgres: PostgresLogo,
  mysql: MySqlLogo,
  sqlite: SqliteLogo,
  redis: RedisLogo,
  mongodb: MongoLogo,
  elasticsearch: ElasticLogo,
  clickhouse: ClickHouseLogo,
  snowflake: SnowflakeLogo,
  supabase: SupabaseLogo,
  filesystem: FilesystemLogo,
  cloudflare: CloudflareLogo,
  aws: AwsLogo,
  vercel: VercelLogo,
  neon: NeonLogo,
  gcp: GcpLogo,
  azure: AzureLogo,
  digitalocean: DigitalOceanLogo,
  qdrant: QdrantLogo,
  discord: DiscordLogo,
  telegram: TelegramLogo,
  twitter: TwitterLogo,
  reddit: RedditLogo,
  youtube: YoutubeLogo,
  spotify: SpotifyLogo,
  twilio: TwilioLogo,
  sendgrid: SendGridLogo,
  'knowledge-graph': KnowledgeGraphLogo,
  'sequential-thinking': SequentialThinkingLogo,
  time: TimeLogo,
  everything: EverythingLogo,
  wikipedia: WikipediaLogo,
  arxiv: ArxivLogo,
  'wolfram-alpha': WolframLogo,
  weather: WeatherLogo,
}
