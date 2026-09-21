import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseUrl, generateComfy, generateCompatible, optimizePrompt, parseWorkflow, prepareWorkflow, recentWorkflow, textBindings } from './client'

const workflow = {
  '459:452': { class_type: 'TextEncodeQwenImage21', inputs: { prompt: '原提示词', negative_prompt: '模糊', clip: ['453', 0] } },
  '458': { class_type: 'KSampler', inputs: { seed: 123, steps: 30 } },
}
const binding = { node: '459:452', input: 'prompt' }
function mockResponses(...values: unknown[]) {
  const mock = vi.fn()
  for (const value of values) mock.mockResolvedValueOnce(new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', mock)
  return mock
}
afterEach(() => vi.unstubAllGlobals())
describe('AI clients', () => {
  it('validates base URLs and preserves provider path prefixes', () => {
    expect(baseUrl(' https://example.com/api/v1/ ')).toBe('https://example.com/api/v1')
    expect(() => baseUrl('file:///secret')).toThrow()
    expect(() => baseUrl('https://user:password@example.com')).toThrow()
  })
  it('accepts API workflows and rejects UI exports', () => {
    expect(parseWorkflow(JSON.stringify({ prompt: workflow }))).toEqual(workflow)
    expect(() => parseWorkflow('{"nodes":[],"links":[]}')).toThrow('API 格式')
  })
  it('supports Qwen subgraph IDs without mutating negative prompts or other settings', () => {
    expect(textBindings(workflow)).toContainEqual(binding)
    const result = prepareWorkflow(workflow, binding, '新提示词')
    expect(result['459:452'].inputs).toEqual({ ...workflow['459:452'].inputs, prompt: '新提示词' })
    expect(workflow['459:452'].inputs.prompt).toBe('原提示词')
    expect(result['458'].inputs.steps).toBe(30)
    expect(() => prepareWorkflow(workflow, { node: 'missing', input: 'text' }, 'x')).toThrow()
  })
  it('chooses the latest successful workflow, ignoring failed entries', async () => {
    mockResponses({ old: { prompt: [1, 'old', workflow], status: { status_str: 'success' } },
      failed: { prompt: [5, 'failed', {}], status: { status_str: 'error' } } })
    expect(await recentWorkflow({ url: 'http://example.com' })).toEqual(workflow)
  })
  it('surfaces execution failures instead of polling forever', async () => {
    mockResponses({ prompt_id: 'id' }, { id: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'out of memory' }]] } } })
    await expect(generateComfy({ url: 'http://example.com' }, workflow, binding, 'prompt', new AbortController().signal, () => {})).rejects.toThrow('out of memory')
  })
  it('does not submit an already-cancelled request', async () => {
    const fetch = mockResponses()
    const abort = new AbortController(); abort.abort()
    await expect(generateComfy({ url: 'http://example.com' }, workflow, binding, 'x', abort.signal, () => {})).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('reads base64 Images API responses', async () => {
    const fetch = mockResponses({ data: [{ b64_json: btoa('image bytes') }] })
    const result = await generateCompatible({ url: 'https://example.com/v1', key: 'test-key', model: 'image-model' }, '猫', '1024x1024')
    expect(await result[0].text()).toBe('image bytes')
    expect(JSON.parse(fetch.mock.calls[0][1].body).prompt).toBe('猫')
  })
  it('never sends the API key to a returned image URL', async () => {
    const fetch = mockResponses({ data: [{ url: 'https://images.example.com/output.png' }] }, {})
    await generateCompatible({ url: 'https://example.com/v1', key: 'test-key', model: 'image-model' }, 'x', 'auto')
    expect(fetch.mock.calls[1][1].headers).not.toHaveProperty('Authorization')
  })
  it('returns optimized text and rejects empty responses', async () => {
    mockResponses({ choices: [{ message: { content: '优化后的描述' } }] }, { choices: [] })
    expect(await optimizePrompt({ url: 'http://example.com/v1', model: 'llm' }, '描述')).toBe('优化后的描述')
    await expect(optimizePrompt({ url: 'http://example.com/v1', model: 'llm' }, '描述')).rejects.toThrow('没有返回文本')
  })
})
