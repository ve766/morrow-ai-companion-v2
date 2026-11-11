import { describe, expect, it } from 'vitest'
import { classifyEndpoint, createEndpointPolicy, isPrivateAddress, maskEndpoint, endpointDigest } from './endpoint-security'

describe('provider endpoint security', () => {
  it('accepts a public HTTPS custom endpoint', () => {
    expect(() => classifyEndpoint('https://relay.example.com/v1', 'custom-proxy')).not.toThrow()
  })

  it('rejects plain HTTP, userinfo, query and fragment for custom endpoints', () => {
    expect(() => classifyEndpoint('http://relay.example.com', 'custom-proxy')).toThrow(/https/)
    expect(() => classifyEndpoint('https://user:secret@relay.example.com', 'custom-proxy')).toThrow(/userinfo/)
    expect(() => classifyEndpoint('https://relay.example.com/?a=1', 'custom-proxy')).toThrow(/query/)
    expect(() => classifyEndpoint('https://relay.example.com/#x', 'custom-proxy')).toThrow(/fragment/)
  })

  it('rejects loopback, private and metadata hosts for custom endpoints', () => {
    for (const endpoint of [
      'https://localhost',
      'https://localhost.',
      'https://127.0.0.1',
      'https://10.0.0.5',
      'https://100.64.0.1',
      'https://100.127.255.254',
      'https://192.168.1.10',
      'https://172.16.0.1',
      'https://169.254.169.254',
      'https://metadata.google.internal',
      'https://[::1]',
      'https://[::ffff:7f00:1]',
      'https://[64:ff9b::7f00:1]',
      'https://[2002:7f00:1::]',
      'https://[fe80::1]'
    ]) {
      expect(() => classifyEndpoint(endpoint, 'custom-proxy')).toThrow()
    }
    expect(() => classifyEndpoint('https://100.128.0.1', 'custom-proxy')).not.toThrow()
    expect(() => classifyEndpoint('https://[2001:4860:4860::8888]', 'custom-proxy')).not.toThrow()
  })

  it('allows loopback only for local profiles and refuses private-network', () => {
    expect(() => classifyEndpoint('http://127.0.0.1:1234', 'local')).not.toThrow()
    expect(() => classifyEndpoint('http://localhost:1234', 'local')).not.toThrow()
    expect(() => classifyEndpoint('http://192.168.1.2:1234', 'local')).toThrow(/loopback/)
    expect(() => classifyEndpoint('https://relay.example.com', 'private-network')).toThrow(/not_supported/)
  })

  it('rejects a hostname whose DNS answer is private', async () => {
    const policy = createEndpointPolicy(async () => [{ address: '10.0.0.7' }])
    await expect(policy.assertAllowed('https://rebind.example.com', 'custom-proxy')).rejects.toThrow(/private/)
  })

  it('accepts a public DNS answer and fails closed on lookup failure', async () => {
    const publicPolicy = createEndpointPolicy(async () => [{ address: '8.8.8.8' }])
    await expect(publicPolicy.assertAllowed('https://relay.example.com', 'custom-proxy')).resolves.toBeUndefined()
    const failing = createEndpointPolicy(async () => { throw new Error('dns down') })
    await expect(failing.assertAllowed('https://relay.example.com', 'custom-proxy')).rejects.toThrow(/dns_lookup_failed/)
  })

  it('classifies IPv4 and IPv6 private ranges', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.1', '169.254.169.254', '0.0.0.0', '224.0.0.1', '100.64.0.1', '100.127.255.254']) {
      expect(isPrivateAddress(address)).toBe(true)
    }
    for (const address of ['8.8.8.8', '1.1.1.1', '100.128.0.1']) expect(isPrivateAddress(address)).toBe(false)
    for (const address of [
      '::1',
      'fc00::1',
      'fd12::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::127.0.0.1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::'
    ]) expect(isPrivateAddress(address)).toBe(true)
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false)
    expect(isPrivateAddress('64:ff9b::808:808')).toBe(false)
  })

  it('masks the endpoint and produces a stable digest', () => {
    expect(maskEndpoint('https://relay.example.com/v1')).toBe('https://relay.example.com/v1')
    expect(endpointDigest('https://relay.example.com/v1')).toMatch(/^[0-9a-f]{16}$/u)
    expect(endpointDigest('https://relay.example.com/v1')).toBe(endpointDigest('https://relay.example.com/v1/'))
  })
})
