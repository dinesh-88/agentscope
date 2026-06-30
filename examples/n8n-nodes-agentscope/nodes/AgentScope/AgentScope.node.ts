import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export class AgentScope implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AgentScope',
		name: 'agentScope',
		group: ['transform'],
		version: 1,
		description: 'Send telemetry payloads to AgentScope',
		defaults: {
			name: 'AgentScope',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'agentScopeApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'ingest',
				options: [
					{
						name: 'Ingest Run Payload',
						value: 'ingest',
						description: 'POST /v1/ingest with run, spans, artifacts',
						action: 'Ingest telemetry run payload',
					},
					{
						name: 'Track SDK Event',
						value: 'telemetry',
						description: 'POST /v1/telemetry anonymous SDK usage event',
						action: 'Track sdk telemetry event',
					},
				],
			},
			{
				displayName: 'Payload JSON',
				name: 'payloadJson',
				type: 'json',
				default: '{"run":{},"spans":[],"artifacts":[]}',
				required: true,
				displayOptions: {
					show: {
						operation: ['ingest'],
					},
				},
				description: 'JSON payload for /v1/ingest',
			},
			{
				displayName: 'Payload JSON',
				name: 'telemetryJson',
				type: 'json',
				default:
					'{"project_id":"project_hash","event":"run_start","sdk":"sdk_ts","sdk_version":"0.1.0","runtime":"node","env":"prod","timestamp":"2026-01-01T00:00:00Z"}',
				required: true,
				displayOptions: {
					show: {
						operation: ['telemetry'],
					},
				},
				description: 'JSON payload for /v1/telemetry',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const credentials = await this.getCredentials('agentScopeApi');
		const baseUrl = String(credentials.baseUrl || '').replace(/\/+$/, '');

		if (!baseUrl) {
			throw new NodeOperationError(this.getNode(), 'AgentScope base URL is required', {
				itemIndex: 0,
			});
		}

		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;

				let endpoint = '/v1/ingest';
				let body: IDataObject;
				let useAuth = true;

				if (operation === 'ingest') {
					body = this.getNodeParameter('payloadJson', i) as IDataObject;
				} else {
					endpoint = '/v1/telemetry';
					body = this.getNodeParameter('telemetryJson', i) as IDataObject;
					useAuth = false;
				}

				const requestOptions: IRequestOptions = {
					url: `${baseUrl}${endpoint}`,
					method: 'POST',
					body,
					json: true,
				};

				let response: unknown;
				if (useAuth) {
					response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'agentScopeApi',
						requestOptions,
					);
				} else {
					response = await this.helpers.httpRequest(requestOptions);
				}

				returnData.push({
					json: {
						ok: true,
						operation,
						status: operation === 'telemetry' ? 204 : 200,
						response: response ?? null,
					},
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							ok: false,
							error: (error as Error).message,
						},
						pairedItem: i,
					});
					continue;
				}

				throw new NodeOperationError(this.getNode(), error as Error, {
					itemIndex: i,
				});
			}
		}

		return [returnData];
	}
}
