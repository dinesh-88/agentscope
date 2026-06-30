import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class AgentScopeApi implements ICredentialType {
	name = 'agentScopeApi';
	displayName = 'AgentScope API';
	documentationUrl = 'https://github.com/your-org/agentscope';
	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'http://localhost:8080',
			required: true,
			description: 'Base URL for the AgentScope API',
		},
		{
			displayName: 'Project API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'Project API key used for /v1/ingest requests',
		},
	];

	authenticate = {
		type: 'generic' as const,
		properties: {
			headers: {
				'x-agentscope-api-key': '={{$credentials.apiKey}}',
			},
		},
	};
}
