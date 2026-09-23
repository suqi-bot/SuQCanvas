import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseUrl, comfyObjectInfo, comfyParamSpec, editCompatibleImage, editDashscopeImage, generateComfy, generateCompatible, optimizePrompt, parseWorkflow, prepareWorkflow, recentWorkflow, resolveDashscopeGenerationUrl, textBindings, uploadComfyImage } from './client'

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
  it('uploads source image to images/edits for OpenAI-compatible img2img', async () => {
    const fetch = mockResponses({ data: [{ b64_json: btoa('layer-a') }, { b64_json: btoa('layer-b') }] })
    const result = await editCompatibleImage({ url: 'https://example.com/v1', key: 'test-key', model: 'edit-model' },
      new Blob(['source'], { type: 'image/png' }), '拆为主体和背景', new AbortController().signal,
      { n: 2, size: '1024x1024', negativePrompt: '水印' })
    expect(result).toHaveLength(2)
    expect(await result[0].text()).toBe('layer-a')
    expect(fetch.mock.calls[0][0]).toContain('/images/edits')
    const form = fetch.mock.calls[0][1].body as FormData
    expect(await (form.get('image') as Blob).text()).toBe('source')
    expect(form.get('prompt')).toBe('拆为主体和背景')
    expect(form.get('model')).toBe('edit-model')
    expect(form.get('n')).toBe('2')
    expect(form.get('size')).toBe('1024x1024')
    expect(form.get('negative_prompt')).toBe('水印')
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer test-key' })
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Content-Type')
  })
  it('never sends the API key to a returned image URL', async () => {
    const fetch = mockResponses({ data: [{ url: 'https://images.example.com/output.png' }] }, {})
    await generateCompatible({ url: 'https://example.com/v1', key: 'test-key', model: 'image-model' }, 'x', 'auto')
    expect(fetch.mock.calls[1][1].headers).not.toHaveProperty('Authorization')
  })
  it('normalizes DashScope base URLs to the multimodal-generation endpoint', () => {
    expect(resolveDashscopeGenerationUrl('https://maas.qianwenaiapi.com/api/v1'))
      .toBe('https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation')
    expect(resolveDashscopeGenerationUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'))
      .toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
    expect(resolveDashscopeGenerationUrl('https://host/v1'))
      .toBe('https://host/api/v1/services/aigc/multimodal-generation/generation')
    const full = 'https://host/api/v1/services/aigc/multimodal-generation/generation'
    expect(resolveDashscopeGenerationUrl(full)).toBe(full)
  })
  it('posts source image as data URL to DashScope multimodal-generation', async () => {
    const fetch = mockResponses({ output: { choices: [{ message: { content: [{ image: 'https://img.example.com/out.png' }] } }] } }, {})
    const result = await editDashscopeImage({ url: 'https://maas.qianwenaiapi.com/api/v1', key: 'test-key', model: 'qwen-image-3.0' },
      new Blob(['source'], { type: 'image/png' }), '拆为主体和背景', new AbortController().signal, { n: 2, negativePrompt: '水印' })
    expect(result).toHaveLength(1)
    expect(await result[0].text()).toBeTruthy()
    expect(fetch.mock.calls[0][0]).toBe('https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation')
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer test-key', 'Content-Type': 'application/json' })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.model).toBe('qwen-image-3.0')
    expect(body.parameters).toMatchObject({ prompt_extend: true, n: 2 })
    const content = body.input.messages[0].content
    expect(content[0].image).toMatch(/^data:image\/png;base64,/)
    expect(content[1].text).toContain('拆为主体和背景')
    expect(content[1].text).toContain('水印')
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
  it('fetches Comfy object_info and parses combo options with numeric ranges', async () => {
    const fetch = mockResponses({
      KSampler: { input: { required: {
        sampler_name: [['euler', 'dpmpp_2m'], {}],
        steps: ['INT', { default: 20, min: 1, max: 10000 }],
        denoise: ['FLOAT', { default: 1, min: 0, max: 1, step: 0.01 }],
        model: ['MODEL', {}],
      } } },
    })
    const info = await comfyObjectInfo({ url: 'http://example.com', key: 'k' })
    expect(fetch.mock.calls[0][0]).toBe('http://example.com/object_info')
    expect(comfyParamSpec(info, 'KSampler', 'sampler_name')).toEqual({ options: ['euler', 'dpmpp_2m'] })
    expect(comfyParamSpec(info, 'KSampler', 'steps')).toEqual({ min: 1, max: 10000 })
    expect(comfyParamSpec(info, 'KSampler', 'denoise')).toEqual({ min: 0, max: 1, step: 0.01 })
    expect(comfyParamSpec(info, 'KSampler', 'model')).toBeNull()
    expect(comfyParamSpec(info, 'MissingNode', 'x')).toBeNull()
    expect(comfyParamSpec(null, 'KSampler', 'steps')).toBeNull()
  })
  it('returns null for plain string inputs that have no range or combo options', () => {
    const info = { Loader: { input: { required: { unet_name: [['a.safetensors'], {}], filename_prefix: ['STRING', { default: 'ComfyUI' }] } } } }
    expect(comfyParamSpec(info, 'Loader', 'unet_name')).toEqual({ options: ['a.safetensors'] })
    expect(comfyParamSpec(info, 'Loader', 'filename_prefix')).toBeNull()
  })
  it('parses the new COMBO format where options live in config.options', () => {
    const info = { ResolutionSelector: { input: { required: {
      aspect_ratio: ['COMBO', { default: '1:1 (Square)', multiselect: false,
        options: ['1:1 (Square)', '2:3 (Portrait Photo)', '16:9 (Widescreen)'] }],
      megapixels: ['FLOAT', { default: 1, min: 0.1, max: 16, step: 0.1 }],
      multiple: ['INT', { default: 8, min: 8, max: 128, step: 4 }],
    } } } }
    expect(comfyParamSpec(info, 'ResolutionSelector', 'aspect_ratio'))
      .toEqual({ options: ['1:1 (Square)', '2:3 (Portrait Photo)', '16:9 (Widescreen)'] })
    expect(comfyParamSpec(info, 'ResolutionSelector', 'megapixels')).toEqual({ min: 0.1, max: 16, step: 0.1 })
    expect(comfyParamSpec(info, 'ResolutionSelector', 'multiple')).toEqual({ min: 8, max: 128, step: 4 })
  })
})
