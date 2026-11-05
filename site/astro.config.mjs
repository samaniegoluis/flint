// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'Flint',
			description: 'An open-source SSH client with a GUI and a CLI over one encrypted vault.',
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
						{ label: 'Vaults', slug: 'guides/vaults' },
						{ label: 'Hosts and groups', slug: 'guides/hosts' },
						{ label: 'SSH keys', slug: 'guides/keys' },
						{ label: 'Credentials', slug: 'guides/credentials' },
						{ label: 'Connecting', slug: 'guides/connecting' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'CLI', slug: 'reference/cli' },
						{ label: 'Vault format', slug: 'reference/vault-format' },
					],
				},
			],
		}),
	],
});
