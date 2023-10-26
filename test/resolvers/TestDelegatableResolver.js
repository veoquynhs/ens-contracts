const ENS = artifacts.require('./registry/ENSRegistry.sol')
const DelegatableResolver = artifacts.require('DelegatableResolver.sol')
const { encodeName, namehash } = require('../test-utils/ens')
const { exceptions } = require('../test-utils')
const { expect } = require('chai')

contract('DelegatableResolver', function (accounts) {
  let node, encodedname
  let ens, resolver
  let account
  let signers

  beforeEach(async () => {
    signers = await ethers.getSigners()
    account = await signers[0].getAddress()
    node = namehash('eth')
    encodedname = encodeName('eth')
    ens = await ENS.new()
    resolver = await DelegatableResolver.new(account)
  })

  describe('supportsInterface function', async () => {
    it('supports known interfaces', async () => {
      assert.equal(await resolver.supportsInterface('0x3b3b57de'), true) // IAddrResolver
      assert.equal(await resolver.supportsInterface('0xf1cb7e06'), true) // IAddressResolver
      assert.equal(await resolver.supportsInterface('0x691f3431'), true) // INameResolver
      assert.equal(await resolver.supportsInterface('0x2203ab56'), true) // IABIResolver
      assert.equal(await resolver.supportsInterface('0xc8690233'), true) // IPubkeyResolver
      assert.equal(await resolver.supportsInterface('0x59d1d43c'), true) // ITextResolver
      assert.equal(await resolver.supportsInterface('0xbc1c58d1'), true) // IContentHashResolver
      assert.equal(await resolver.supportsInterface('0xa8fa5682'), true) // IDNSRecordResolver
      assert.equal(await resolver.supportsInterface('0x5c98042b'), true) // IDNSZoneResolver
      assert.equal(await resolver.supportsInterface('0x01ffc9a7'), true) // IInterfaceResolver
      assert.equal(await resolver.supportsInterface('0x4fbf0433'), true) // IMulticallable
      assert.equal(await resolver.supportsInterface('0xf21ce672'), true) // IDelegatable
    })

    it('does not support a random interface', async () => {
      assert.equal(await resolver.supportsInterface('0x3b3b57df'), false)
    })
  })

  describe('addr', async () => {
    it('permits setting address by owner', async () => {
      var tx = await resolver.methods['setAddr(bytes32,address)'](
        node,
        accounts[1],
        { from: accounts[0] },
      )
      assert.equal(await resolver.methods['addr(bytes32)'](node), accounts[1])
    })

    it('forbids setting new address by non-owners', async () => {
      await exceptions.expectFailure(
        resolver.methods['setAddr(bytes32,address)'](node, accounts[1], {
          from: accounts[1],
        }),
      )
    })
  })

  describe('authorisations', async () => {
    it('approves multiple users', async () => {
      await resolver.approve(encodedname, accounts[1], true)
      await resolver.approve(encodedname, accounts[2], true)
      const result = await resolver.getAuthorizedNode(
        encodedname,
        0,
        accounts[1],
      )
      assert.equal(result.node, node)
      assert.equal(result.authorized, true)
      assert.equal(
        (await resolver.getAuthorizedNode(encodedname, 0, accounts[2]))
          .authorized,
        true,
      )
    })

    it('approves subnames', async () => {
      const subname = 'a.b.c.eth'
      await resolver.approve(encodeName(subname), accounts[1], true)
      await resolver.methods['setAddr(bytes32,address)'](
        namehash(subname),
        accounts[1],
        {
          from: accounts[1],
        },
      )
    })

    it('approves users to make changes', async () => {
      await resolver.approve(encodedname, accounts[1], true)
      await resolver.methods['setAddr(bytes32,address)'](node, accounts[1], {
        from: accounts[1],
      })
      assert.equal(await resolver.addr(node), accounts[1])
    })

    it('approves to be cleared', async () => {
      await resolver.approve(encodedname, accounts[1], false)
      await exceptions.expectFailure(
        resolver.methods['setAddr(bytes32,address)'](node, accounts[0], {
          from: accounts[1],
        }),
      )
    })

    it('does not allow non owner to approve', async () => {
      await expect(
        resolver.approve(encodedname, accounts[1], true, { from: accounts[1] }),
      ).to.be.revertedWith('NotAuthorized')
    })

    it('emits an Approval log', async () => {
      var operator = accounts[1]
      var tx = await resolver.approve(encodedname, operator, true)
      assert.equal(tx.logs.length, 1)
      assert.equal(tx.logs[0].event, 'Approval')
      assert.equal(tx.logs[0].args.node, node)
      assert.equal(tx.logs[0].args.operator, operator)
      assert.equal(tx.logs[0].args.name, encodedname)
      assert.equal(tx.logs[0].args.approved, true)
    })
  })

  describe('isOwner', async () => {
    it('the deployer is the owner by default', async () => {
      assert.equal(await resolver.isOwner(account), true)
    })

    it('can have multiple owner', async () => {
      await resolver.approve(encodeName(''), accounts[1], true)
      assert.equal(await resolver.isOwner(accounts[1]), true)
    })
  })

  describe('multicall', async () => {
    it('allows setting multiple fields', async () => {
      var addrSet = resolver.contract.methods['setAddr(bytes32,address)'](
        node,
        accounts[1],
      ).encodeABI()
      var textSet = resolver.contract.methods
        .setText(node, 'url', 'https://ethereum.org/')
        .encodeABI()
      var tx = await resolver.multicall([addrSet, textSet], {
        from: accounts[0],
      })

      assert.equal(tx.logs.length, 3)
      assert.equal(tx.logs[0].event, 'AddressChanged')
      assert.equal(tx.logs[0].args.node, node)
      assert.equal(tx.logs[0].args.newAddress, accounts[1].toLowerCase())
      assert.equal(tx.logs[1].event, 'AddrChanged')
      assert.equal(tx.logs[1].args.node, node)
      assert.equal(tx.logs[1].args.a, accounts[1])
      assert.equal(tx.logs[2].event, 'TextChanged')
      assert.equal(tx.logs[2].args.node, node)
      assert.equal(tx.logs[2].args.key, 'url')

      assert.equal(await resolver.methods['addr(bytes32)'](node), accounts[1])
      assert.equal(await resolver.text(node, 'url'), 'https://ethereum.org/')
    })

    it('allows reading multiple fields', async () => {
      await resolver.methods['setAddr(bytes32,address)'](node, accounts[1], {
        from: accounts[0],
      })
      await resolver.setText(node, 'url', 'https://ethereum.org/', {
        from: accounts[0],
      })
      var results = await resolver.multicall.call([
        resolver.contract.methods['addr(bytes32)'](node).encodeABI(),
        resolver.contract.methods.text(node, 'url').encodeABI(),
      ])
      assert.equal(
        web3.eth.abi.decodeParameters(['address'], results[0])[0],
        accounts[1],
      )
      assert.equal(
        web3.eth.abi.decodeParameters(['string'], results[1])[0],
        'https://ethereum.org/',
      )
    })
  })
})