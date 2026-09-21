import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseUrl, generateComfy, generateCompatible, optimizePrompt, parseWorkflow, prepareWorkflow, recentWorkflow, textBindings, uploadComfyImage } from './client'

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
  it('binds negative text separately and rejects colliding bindings', () => {
    const negative = { binding: { node: '459:452', input: 'negative_prompt' }, prompt: '水印' }
    const result = prepareWorkflow(workflow, binding, '猫', false, negative)
    expect(result['459:452'].inputs.prompt).toBe('猫')
    expect(result['459:452'].inputs.negative_prompt).toBe('水印')
    expect(workflow['459:452'].inputs.negative_prompt).toBe('模糊')
    expect(() => prepareWorkflow(workflow, binding, '猫', false, { binding, prompt: '' })).toThrow('同一个输入')
    expect(prepareWorkflow(workflow, binding, '猫', false, { ...negative, prompt: '' })['459:452'].inputs.negative_prompt).toBe('')
  })
  it('only sends the optional negative_prompt extension when populated', async () => {
    const fetch = mockResponses({ data: [{ b64_json: btoa('image') }] }, { data: [{ b64_json: btoa('image') }] })
    const endpoint = { url: 'https://example.com/v1', model: 'image' }
    await generateCompatible(endpoint, '猫', 'auto', undefined, '水印')
    await generateCompatible(endpoint, '猫', 'auto')
    expect(JSON.parse(fetch.mock.calls[0][1].body).negative_prompt).toBe('水印')
    expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty('negative_prompt')
  })
  it('uploads the source image as multipart and uses the returned server filename', async () => {
    const fetch = mockResponses({ name: 'renamed.png', subfolder: 'inputs' })
    expect(await uploadComfyImage({ url: 'http://example.com', key: 'key' }, new Blob(['pixels'], { type: 'image/png' }), new AbortController().signal)).toBe('inputs/renamed.png')
    const form = fetch.mock.calls[0][1].body as FormData
    expect(await (form.get('image') as Blob).text()).toBe('pixels')
    expect(form.get('type')).toBe('input')
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Content-Type')
  })
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
  it('submits the saved workflow seed and parameters without randomizing them again', async () => {
    const prepared = prepareWorkflow(workflow, binding, '固定参数', false)
    expect(prepared['458'].inputs.seed).toBe(123)
    const fetch = mockResponses({ prompt_id: 'id' }, { id: { status: { completed: true }, outputs: { image: { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } } } }, {})
    await generateComfy({ url: 'http://example.com' }, prepared, binding, '固定参数', new AbortController().signal, () => {}, true)
    expect(JSON.parse(fetch.mock.calls[0][1].body).prompt).toEqual(prepared)
    expect(workflow['459:452'].inputs.prompt).toBe('原提示词')
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
  it('optimizes both prompts with existing negative constraints and rejects empty responses', async () => {
    const fetch = mockResponses({ choices: [{ message: { content: JSON.stringify({ prompt: '优化后的描述', negativePrompt: '水印、模糊' }) } }] }, { choices: [] })
    expect(await optimizePrompt({ url: 'http://example.com/v1', model: 'llm' }, '描述', '水印')).toEqual({ prompt: '优化后的描述', negativePrompt: '水印、模糊' })
    expect(JSON.parse(JSON.parse(fetch.mock.calls[0][1].body).messages[1].content)).toEqual({ prompt: '描述', negativePrompt: '水印' })
    await expect(optimizePrompt({ url: 'http://example.com/v1', model: 'llm' }, '描述')).rejects.toThrow('没有返回文本')
  })
  it('generates negative text for a blank input and accepts fenced JSON', async () => {
    const fetch = mockResponses({ choices: [{ message: { content: '```json\n{"prompt":"猫", "negativePrompt":"多余肢体、失焦"}\n```' } }] })
    expect(await optimizePrompt({ url: 'http://example.com/v1', model: 'llm' }, '猫', '  ')).toEqual({ prompt: '猫', negativePrompt: '多余肢体、失焦' })
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages[0].content).toContain('必须根据正向需求同步生成')
  })
  it('rejects malformed or incomplete pairs instead of silently replacing negative text', async () => {
    for (const content of ['描述', '{}', '{"prompt":"猫"}', '{"prompt":"", "negativePrompt":"模糊"}', '{"prompt":"猫", "negativePrompt":[]}', '{"prompt":"猫", "negativePrompt":"  "}']) {
      mockResponses({ choices: [{ message: { content } }] })
      await expect(optimizePrompt({ url: 'http://example.com/v1', model: 'llm' }, '猫', '水印')).rejects.toThrow('原提示词未修改')
    }
  })
})
