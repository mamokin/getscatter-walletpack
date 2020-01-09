
export let Blockchains = {
    EOSIO:'eos',
    ETH:'eth',
    TRX:'trx',
    BTC:'btc',
    PPY:'ppy'
};

export let BlockchainsArray = Object.keys(Blockchains).map(key => ({key, value:Blockchains[key]}));

export let blockchainName = x => {
    switch(x){
        case 'btc': return 'Bitcoin';
        case Blockchains.EOSIO: return 'EOSIO';
        case Blockchains.ETH: return 'Ethereum';
        case Blockchains.TRX: return 'Tron';
        case Blockchains.BTC: return 'Bitcoin';
        case Blockchains.PPY: return 'Peerplays';
        default: return x;
    }
};

export const setBlockchains = (_Blockchains, _blockchainNameParser = null) => {
	Blockchains = _Blockchains;
	BlockchainsArray = Object.keys(Blockchains).map(key => ({key, value:Blockchains[key]}));
	if(_blockchainNameParser) blockchainName = _blockchainNameParser;
}