// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'Flint',
			description: 'An open-source SSH client with a GUI and a CLI over one encrypted vault.',
			// Flint's visual identity (D-023): tokens from docs/design/tokens.css, the logo
			// from docs/design/icons.svg, and a theme button that is always in the header.
			logo: {
				dark: './src/assets/flint-logo-dark.svg',
				light: './src/assets/flint-logo-light.svg',
				alt: '',
			},
			customCss: ['./src/styles/flint.css'],
			components: {
				Header: './src/components/Header.astro',
				MobileMenuFooter: './src/components/MobileMenuFooter.astro',
			},
			expressiveCode: {
				themes: ['github-dark-default', 'github-light-default'],
				styleOverrides: {
					borderRadius: '8px',
					borderColor: 'var(--sl-color-hairline-light)',
					codeBackground: 'var(--flint-term-bg)',
					codeFontFamily: 'var(--__sl-font-mono)',
					uiFontFamily: 'var(--__sl-font)',
					frames: {
						editorTabBarBackground: 'var(--sl-color-gray-6)',
						terminalTitlebarBackground: 'var(--sl-color-gray-6)',
						terminalBackground: 'var(--flint-term-bg)',
						frameBoxShadowCssValue: 'none',
					},
				},
			},
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'Introduction', slug: 'start/introduction' },
						{ label: 'Build from source', slug: 'start/build-from-source' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'The desktop app', slug: 'guides/desktop-app' },
						{ label: 'Vaults', slug: 'guides/vaults' },
						{ label: 'Hosts and groups', slug: 'guides/hosts' },
						{ label: 'SSH keys', slug: 'guides/keys' },
						{ label: 'Credentials', slug: 'guides/credentials' },
						{ label: 'Connecting', slug: 'guides/connecting' },
						{ label: 'Copying files', slug: 'guides/files' },
						{ label: 'The Files view', slug: 'guides/files-view' },
						{ label: 'Tunnels', slug: 'guides/tunnels' },
						{ label: 'Remote desktop', slug: 'guides/remote-desktop' },
						{ label: 'Use Flint with an AI agent', slug: 'guides/ai-agents' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'CLI', slug: 'reference/cli' },
						{ label: 'Keyboard shortcuts', slug: 'reference/keyboard-shortcuts' },
						{ label: 'Vault format', slug: 'reference/vault-format' },
						{ label: 'Security model', slug: 'reference/security-model' },
					],
				},
			],
		}),
	],
});
