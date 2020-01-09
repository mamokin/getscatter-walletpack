import Plugin from                      '@walletpack/core/plugins/Plugin';
import * as PluginTypes from            '@walletpack/core/plugins/PluginTypes';
import * as Actions from                '@walletpack/core/models/api/ApiActions';
import {Blockchains} from               '@walletpack/core/models/Blockchains'
import Network from                     '@walletpack/core/models/Network'
import KeyPairService from              '@walletpack/core/services/secure/KeyPairService';
import Token from                       "@walletpack/core/models/Token";
import HardwareService from             "@walletpack/core/services/secure/HardwareService";
import StoreService from                "@walletpack/core/services/utility/StoreService";
import TokenService from                "@walletpack/core/services/utility/TokenService";
import EventService from                "@walletpack/core/services/utility/EventService";
import SigningService from              "@walletpack/core/services/secure/SigningService";
import ecc from 'eosjs-ecc';
import {PrivateKey, key} from "peerplaysjs-lib";

//TO-DO: Replace with Peerplays explorer.
const EXPLORER = {
	"name":"Bloks",
	"account":"https://bloks.io/account/{x}",
	"transaction":"https://bloks.io/transaction/{x}",
	"block":"https://bloks.io/block/{x}"
};

export default class PPY extends Plugin {

	constructor(){
		 super('ppy', PluginTypes.BLOCKCHAIN_SUPPORT) 
	}

	bip(){ return `44'/195'/0'/0/`}
	bustCache(){ cachedInstances = {}; }
	defaultExplorer(){ return EXPLORER; }
	accountFormatter(account){ return `${account.publicKey}` }
	returnableAccount(account){ return { address:account.publicKey, blockchain:Blockchains.TRX }}

	contractPlaceholder(){ return '0x.....'; }

	checkNetwork(network){
		return Promise.race([
			new Promise(resolve => setTimeout(() => resolve(null), 2000)),
			fetch(`${network.fullhost()}/v1/chain/get_info`).then(() => true).catch(() => false),
		])
	}

	getEndorsedNetwork(){
		//TO-DO: Replace with Peerplays mainnet.
		return new Network('EOS Mainnet', 'https', 'nodes.get-scatter.com', 443, Blockchains.EOSIO, MAINNET_CHAIN_ID)
	}

	isEndorsedNetwork(network){
		const endorsedNetwork = this.getEndorsedNetwork();
		return network.blockchain === 'ppy' && network.chainId === endorsedNetwork.chainId;
	}

	async getChainId(network){
		return 1;
	}

	usesResources(){ return false; }
	hasAccountActions(){ return false; }

	accountsAreImported(){ return true; }
	
	isValidRecipient(name){ return /(^[a-z1-5.]{1}([a-z1-5.]{0,10}[a-z1-5])?$)/g.test(name); }
	privateToPublic(privateKey, prefix = null){ return ecc.PrivateKey(privateKey).toPublic().toString(prefix ? prefix : 'PPY'); }
	validPrivateKey(privateKey){ return privateKey.length >= 50 && ecc.isValidPrivate(privateKey); }
	validPublicKey(publicKey, prefix = null){
		try {
			return ecc.PublicKey.fromStringOrThrow(publicKey, prefix ? prefix : Blockchains.EOSIO.toUpperCase());
		} catch(e){
			return false;
		}
	}
	bufferToHexPrivate(buffer){ // Private Key
		return ecc.PrivateKey.fromBuffer(Buffer.from(buffer)).toString()
	}
	hexPrivateToBuffer(privateKey){
		return new ecc.PrivateKey(privateKey).toBuffer();
	}

	hasUntouchableTokens(){ return false; }

	async balanceFor(account, token){
		const balances = await Promise.race([
			new Promise(resolve => setTimeout(() => resolve([]), 10000)),
			getTableRows(account.network(), {
				json:true,
				code:token.contract,
				scope:account.name,
				table:'accounts',
				limit:500
			}).then(res => res.rows).catch(() => [])
		]);

		const row = balances.find(row => row.balance.split(" ")[1].toLowerCase() === token.symbol.toLowerCase());
		return row ? row.balance.split(" ")[0] : 0;
	}

	async balancesFor(account, tokens, fallback = false){
		if(!fallback && this.isEndorsedNetwork(account.network())){
			const balances = await EosTokenAccountAPI.getAllTokens(account);
			if(!balances) return this.balanceFor(account, tokens, true);
			const blacklist = StoreService.get().state.scatter.settings.blacklistTokens.filter(x => x.blockchain === Blockchains.EOSIO).map(x => x.unique());
			return balances.filter(x => !blacklist.includes(x.unique()));
		}


		return (await Promise.all(tokens.map(async token => {
			const t = token.clone();
			t.amount = await this.balanceFor(account, token);
			t.chainId = account.network().chainId;
			return t;
		})));
	}

	defaultDecimals(){ return 4; }
	defaultToken(){ return new Token(Blockchains.EOSIO, 'eosio.token', 'EOS', 'EOS', this.defaultDecimals(), MAINNET_CHAIN_ID) }
	actionParticipants(payload){ return payload.transaction.participants }


	async transfer({account, to, amount, token, memo, promptForSignature = true}){
		if(!this.isValidRecipient(to)) return {error:'Invalid recipient account name'};
		amount = parseFloat(amount).toFixed(token.decimals);
		const {contract, symbol} = token;
		const amountWithSymbol = amount.indexOf(symbol) > -1 ? amount : `${amount} ${symbol}`;


		return new Promise(async (resolve, reject) => {
			const eos = this.getSignableEosjs(account, reject, promptForSignature);

			const result = await eos.transact({
				actions:[{
					account: contract,
					name:'transfer',
					authorization: [{
						actor: account.sendable(),
						permission: account.authority,
					}],
					data:{
						from: account.name,
						to,
						quantity:amountWithSymbol,
						memo:memo,
					},
				}]
			}, {
				blocksBehind: 3,
				expireSeconds: 30,
			})
				.catch(res => resolve({error:popupError(res)}))
				.then(result => resolve(result))
		})
	}

	async signer(payload, publicKey, arbitrary = false, isHash = false, privateKey = null){
		if(!privateKey) privateKey = await KeyPairService.publicToPrivate(publicKey);
		if (!privateKey) return;

		if(typeof privateKey !== 'string') privateKey = this.bufferToHexPrivate(privateKey);

		if (arbitrary && isHash) return ecc.Signature.signHash(payload.data, privateKey).toString();
		return ecc.sign(Buffer.from(arbitrary ? payload.data : payload.buf, 'utf8'), privateKey);
	}

	async signerWithPopup(payload, account, rejector){
		return new Promise(async resolve => {
			payload.messages = await this.requestParser(payload);
			payload.identityKey = StoreService.get().state.scatter.keychain.identities[0].publicKey;
			payload.participants = [account];
			payload.network = account.network();
			payload.origin = 'Scatter';
			const request = {
				payload,
				origin:payload.origin,
				blockchain:Blockchains.TRX,
				requiredFields:{},
				type:Actions.SIGN,
				id:1,
			}

			EventService.emit('popout', request).then( async ({result}) => {
				if(!result || (!result.accepted || false)) return rejector({error:'Could not get signature'});

				let signature = null;
				if(KeyPairService.isHardware(account.publicKey)){
					signature = await HardwareService.sign(account, payload);
				} else signature = await SigningService.sign(payload.network, payload, account.publicKey);

				if(!signature) return rejector({error:'Could not get signature'});

				resolve(signature);
			}, true);
		})
	}

	async requestParser(payload, network){
		if(payload.transaction.hasOwnProperty('serializedTransaction'))
			return this.parseEosjs2Request(payload, network);
		else return this.parseEosjsRequest(payload, network);
	}

}