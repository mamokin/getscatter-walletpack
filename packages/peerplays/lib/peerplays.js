import Plugin from '@walletpack/core/plugins/Plugin';
import * as PluginTypes from '@walletpack/core/plugins/PluginTypes';
import * as Actions from '@walletpack/core/models/api/ApiActions';
import { Blockchains } from '@walletpack/core/models/Blockchains';
import Network from '@walletpack/core/models/Network';
import KeyPairService from '@walletpack/core/services/secure/KeyPairService';
import Token from '@walletpack/core/models/Token';
import Account from '@walletpack/core/models/Account';
import HardwareService from '@walletpack/core/services/secure/HardwareService';
import StoreService from '@walletpack/core/services/utility/StoreService';
import EventService from '@walletpack/core/services/utility/EventService';
import SigningService from '@walletpack/core/services/secure/SigningService';
// import SigningService from '../../core/lib/services/secure/SigningService'; // uncomment if running into issues with transfer unit test
import BigNumber from 'bignumber.js';
const fetch = require('node-fetch');

import { ChainValidation, Login, PublicKey, PrivateKey as Pkey } from 'peerplaysjs-lib';
import _PPY from './_PPY';
import PPYKeypairService from './PPYKeypairService';

const EXPLORER = {
  name: 'PeerplaysBlockchain',
  account: 'https://peerplaysblockchain.info/account/{x}',
  transaction: 'https://peerplaysblockchain.info/explorer/transactions/{x}',
  block: 'https://peerplaysblockchain.info/block/{x}',
};

const MAINNET_CHAIN_ID = '6b6b5f0ce7a36d323768e534f3edb41c6d6332a541a95725b98e28d140850134';
const USE_TESTNET = 1;
let cachedInstances;

export default class PPY extends Plugin {
  constructor() {
    super('ppy', PluginTypes.BLOCKCHAIN_SUPPORT);
  }

  bip() {
    return `44'/194'/0'/0/`;
  }

  bustCache() {
    cachedInstances = {};
  }

  defaultExplorer() {
    return EXPLORER;
  }

  accountFormatter(account) {
    return account.name;
  }

  returnableAccount(account) {
    return { name: account.name, address: account.publicKey, blockchain: Blockchains.PPY };
  }

  // TO-DO:
  contractPlaceholder() {
    return '';
  }

  checkNetwork(network) {
    return Promise.race([
      new Promise(resolve => setTimeout(() => resolve(null), 2000)),
      _PPY
        .getChainId(network.host)
        .then(() => {this.host = network.host; return true})
        .catch(() => false),
    ]);
  }

  getEndorsedNetwork() {
    return new Network(
      'Peerplays Mainnet',
      'https',
      'api.eifos.org',
      7777,
      Blockchains.PPY,
      MAINNET_CHAIN_ID
    );
  }

  /**
   * Generate keys role=("owner"|"active"|"memo") from (password + accountName + role)
   *
   * @param {String} accountName
   * @param {String} password
   * @param {Array} roles
   * @param {String} prefix
   * @returns {Object} Keypair
   */
  generateKeys(accountName, password, roles = ['owner', 'active', 'memo'], prefix = 'TEST') {
    const { privKeys } = Login.generateKeys(accountName, password, roles, prefix);
    const wifs = {};

    // Generate WIF for each private key (3 for each authority level).
    for (const [authority, privKey] of Object.entries(privKeys)) {
      wifs[authority] = this.wifFromPrivate(privKey);
    }

    // You can assign other keypair instances to the returned keypair as it is an instance of Scatter KeyPair
    // ie: keypair.blockchains = ['ppy']
    return PPYKeypairService.newKeypair(wifs, prefix);
  }

  isAccountNameError(username) {
    return ChainValidation.is_account_name_error(username);
  }

  isEndorsedNetwork(network) {
    const endorsedNetwork = this.getEndorsedNetwork();
    return network.blockchain === 'ppy' && network.chainId === endorsedNetwork.chainId;
  }

  async getChainId() {
    return await _PPY.getChainId();
  }

  async authUser(accountName, password) {
    const auth = _PPY.authUser(accountName, password);
    if (!auth) {
      return null;
    }
    return auth;
  }

  async register(username, password) {
    const response = await _PPY.register(2, username, password);
    return response;
  }

  usesResources() {
    return false;
  }

  hasAccountActions() {
    return false;
  }

  accountsAreImported() {
    return true;
  }

  isValidRecipient(name) {
    return ChainValidation.is_account_name(name);
  }

  /**
   *
   *
   * @param {Object} keypair
   * @param {Object} network
   * @returns {Promise} Account Object
   * @memberof PPY
   */
  getImportableAccounts(keypair, network) {
    return new Promise((resolve, reject) => {
      if (!keypair.username) {
        console.error('no username');
        return resolve([]);
      }

      if (!keypair.publicKeys) {
        console.error('no publicKey');
        return resolve([]);
      }

      let publicKey = keypair.publicKeys[0].key;

      resolve([
        Account.fromJson({
          name: keypair.username,
          authority: 'owner',
          publicKey,
          keypairUnique: keypair.unique(),
          networkUnique: network.unique(),
        }),
      ]);
    });
  }

  /**
   * Take an input Wallet Import Format (WIF) key (application code is calling WIFs private keys) and convert that to a PrivateKey.
   *
   * @param {string} privateKeyWif - WIF format key.
   * @param {string} [prefix=null] - Chain prfix.
   * @returns
   * @memberof PPY
   */
  privateToPublic(privateKeyWif, prefix = null) {
    return _PPY
      .privateFromWif(privateKeyWif)
      .toPublicKey()
      .toPublicKeyString(prefix ? prefix : 'PPY');
  }

  /**
   * Convert a PrivateKey object to a Wallet Import Format (WIF) key
   *
   * @param {Object} privateKey
   * @returns {String} - Wallet Import Format (WIF) key
   * @memberof PPY
   */
  wifFromPrivate(privateKey) {
    return privateKey.toWif();
  }

  validPrivateKey(privateKey) {
    return true;
  }

  validPublicKey(publicKey, prefix = null) {
    try {
      return PublicKey.fromStringOrThrow(publicKey, prefix ? prefix : 'PPY');
    } catch (e) {
      return false;
    }
  }

  bufferToHexPrivate(buffer) {
    let keyNumAry = buffer.data;
    return String.fromCharCode.apply(null, keyNumAry);
  }

  hexPrivateToBuffer(privateKey) {
    return new Pkey.fromWif(privateKey).toBuffer();
  }

  hasUntouchableTokens() {
    return false;
  }

  defaultDecimals() {
    return 5; // ui does not call this async so we have to hardcode
  }

  defaultToken() {
    return new Token(Blockchains.PPY, 'ppy', 'PPY', 'PPY', 5, MAINNET_CHAIN_ID);
  }

  actionParticipants(payload) {
    return payload.transaction.participants;
  }

  /***
   * Gets an array of token's values.
   * The `tokens` param might also be omitted which would mean to grab "all available tokens for an account".
   * Returns an array of Token class.
   */
  async balancesFor(account, tokens, fallback = false) {
    let fullAccount = await _PPY.getFullAccountObject(account.name, account.network().host);
    let unformattedBalance;
    let tokenArray = [];
    let assetId = '1.3.0';

    tokens.map(async token => {
      const t = token.clone();
      const symbol = token.symbol.toUpperCase();

      if (symbol === 'PPY') {
        assetId = '1.3.0';
      } else if (symbol === 'BTF') {
        assetId = '1.3.1';
      }

      let assetIndex = fullAccount.balances.findIndex(asset => asset.asset_type === assetId);

      if (assetIndex === -1) {
        return;
      }

      unformattedBalance = fullAccount.balances[assetIndex].balance;
      const balance =
        new BigNumber(unformattedBalance) / Math.pow(10, await this.defaultDecimals(assetId));
      t.amount = balance;
      tokenArray.push(t);
    });

    return tokenArray;
  }

  /***
   * Gets a single token's balance.
   * Returns a Token class where `token.amount` is the balance.
   */
  async balanceFor(account, token) {
    let fullAccount = await _PPY.getFullAccountObject(account.name, account.network().host);
    let unformattedBalance;
    let assetId = '1.3.0';

    if (token.symbol.toUpperCase() === 'PPY') {
      assetId = '1.3.0';
    } else if (token.symbol.toUpperCase() === 'BTF') {
      assetId = '1.3.1';
    }
    const assetIndex = fullAccount.balances.findIndex(asset => asset.asset_type === assetId);
    unformattedBalance = fullAccount.balances[assetIndex].balance;
    const balance =
      new BigNumber(unformattedBalance) / Math.pow(10, await this.defaultDecimals(assetId));
    const clone = token.clone();
    clone.amount = balance;
    return clone;
  }

  async signerWithPopup(payload, account, rejector) {
    return new Promise(async resolve => {
      // payload.messages = await this.requestParser(payload);
      payload.identityKey = StoreService.get().state.scatter.keychain.identities[0].publicKey;
      payload.participants = [account];
      payload.network = account.network();
      payload.origin = 'Scatter';
      const request = {
        payload,
        origin: payload.origin,
        blockchain: 'ppy',
        requiredFields: {},
        type: Actions.SIGN,
        id: 1,
      };

      EventService.emit('popout', request).then(async ({ result }) => {
        if (!result || !result.accepted || false)
          return rejector({ error: 'Could not get signature' });

        let signature = null;
        if (KeyPairService.isHardware(account.publicKey)) {
          signature = await HardwareService.sign(account, payload);
        } else signature = await SigningService.sign(payload.network, payload, account.publicKey);

        if (!signature) return rejector({ error: 'Could not get signature' });

        resolve(signature);
      }, true);
    });
  }

  async requestParser(payload, network) {
    if (payload.transaction.hasOwnProperty('serializedTransaction'))
      return this.parseEosjs2Request(payload, network);
    else return this.parseEosjsRequest(payload, network);
  }

  /**
   * Add the data (keys, memo) needed to sign the transaction.
   *
   * @param {Object} payload - contains the transaction
   * @param {Object} pub - PublicKey.
   * @param {boolean} [arbitrary=false]
   * @param {boolean} [isHash=false]
   * @param {Object} [priv=null] - Keypair.privateKey or equivalent.
   * @returns {Object} transaction
   * @memberof PPY
   */
  async signer(payload, pub, arbitrary = false, isHash = false, priv = null) {
    if (!payload || !pub) {
      throw new Error('Signer: Missing inputs');
    }

    let wifs, privActiveWif, privMemoWif, privActiveKey, tr;

    tr = payload.transaction;

    if (typeof priv === 'string') {
      wifs = PPYKeypairService.getWifs(priv);
      privActiveWif = wifs.active;
      privMemoWif = wifs.memo;

      privActiveKey = _PPY.privateFromWif(privActiveWif);
    }

    // BUILD MEMO
    const {recipient, message, op} = tr;
    // Remove the temp properties from tr.
    delete tr.recipient;
    delete tr.message;
    delete tr.op;

    let memoObject;

    // ASSIGN DATA TO TRANSACTION
    op.memo = message ? await _PPY.buildMemo(message, privMemoWif, recipient) : memoObject;
    let transferOp = tr.get_type_operation('transfer', op); // performs serialization on `op` to verify correct data input

    // Add the transfer operation to the transaction
    tr.add_operation(transferOp);

    // SET FEES
    await _PPY.setRequiredFees(undefined, tr);

    // SIGN
    tr.add_signer(privActiveKey, pub);

    return tr;
  }

  /**
   * Perform transfer
   *
   * @param {{account: Object, to: String, amount: Number, memo: String, token: String, promptForSignature: Boolean}}
   * @returns {Promise} resolve/reject - Resolve with transaction id if their is one. Reject with error if there is one.
   * @memberof PPY
   */
  async transfer({ account, to, amount, memo, token, promptForSignature = false }) {
    if (!account || !to || !amount || !token) {
      throw new Error('transfer: Missing inputs');
    }

    const host = account.network().host; //
    const from = account.name;
    const publicActiveKey = account.publicKey;
    amount = _PPY.convertToChainAmount(amount, token);

    // Get the transaction
    let transferTransaction = await _PPY.getTransferTransaction(
      from,
      to,
      amount,
      memo,
      '1.3.0',
      host
    );

    // Build payload
    let payload = {};
    payload.transaction = transferTransaction;

    // Sign the transaction
    if (promptForSignature) {
      transferTransaction = await this.signerWithPopup(transferTransaction, account, finished);
    } else {
      // SIGN
      transferTransaction = await SigningService.sign(account.network(), payload, publicActiveKey);

      // FINALIZE
      transferTransaction = await _PPY.finalize(transferTransaction, host);

      const callback = () => {
        console.info('callback executing after broadcast');
      };

      // BROADCAST
      return new Promise((resolve, reject) => {
        _PPY
          .broadcast(transferTransaction, callback, host)
          .then(() => {
            resolve(transferTransaction.tr_buffer.toString('hex'));
          })
          .catch(err => {
            reject(err);
          });
      });
    }
  }
}