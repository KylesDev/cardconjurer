//Create objects for common properties across available frames
var cardWidth = 2043;
var cardHeight = 2788;
var masks = []
var ptMasks = [{src:'/img/frames/custom/kyles/masks/minimalist_power.svg', name:'Power'}, {src:'/img/frames/custom/kyles/masks/minimalist_toughness.svg', name:'Toughness'}]
var bounds = {x:0.7573, y:0.8848, width:0.188, height:0.0733};
//defines available frames

var ptBounds = {x:1519/cardWidth, y:2578/cardHeight, width:230/cardWidth, height:75/cardHeight};

availableFrames = [
	{name:'Clear Frame', src:'/img/frames/custom/kyles/frames/minimalist/clear.png', masks:masks},
	{name:'White Frame', src:'/img/frames/custom/kyles/frames/minimalist/W.png', masks:masks},
	{name:'Blue Frame', src:'/img/frames/custom/kyles/frames/minimalist/U.png', masks:masks},
	{name:'Black Frame', src:'/img/frames/custom/kyles/frames/minimalist/B.png', masks:masks},
	{name:'Red Frame', src:'/img/frames/custom/kyles/frames/minimalist/R.png', masks:masks},
	{name:'Green Frame', src:'/img/frames/custom/kyles/frames/minimalist/G.png', masks:masks},
	{name:'Multicolored Frame', src:'/img/frames/custom/kyles/frames/minimalist/gold.png', masks:masks},
	{name:'Land Frame', src:'/img/frames/custom/kyles/frames/minimalist/land.png', masks:masks},
	{name:'Artifact Frame', src:'/img/frames/custom/kyles/frames/minimalist/artifact.png', masks:masks},
	{name:'Vehicle Frame', src:'/img/frames/custom/kyles/frames/minimalist/vehicle.png', masks:masks},

	{name:'Clear Power/Toughness Box', src:'/img/frames/custom/kyles/frames/minimalist/pt/pt.png', masks:ptMasks},
	{name:'White Power/Toughness Box', src:'/img/frames/custom/kyles/frames/minimalist/pt/ptw.png', masks:ptMasks},
	{name:'Blue Power/Toughness Box', src:'/img/frames/custom/kyles/frames/minimalist/pt/ptu.png', masks:ptMasks},
	{name:'Black Power/Toughness Box', src:'/img/frames/custom/kyles/frames/minimalist/pt/ptb.png', masks:ptMasks},
	{name:'Red Power/Toughness Box', src:'/img/frames/custom/kyles/frames/minimalist/pt/ptr.png', masks:ptMasks},
	{name:'Green Power/Toughness Box', src:'/img/frames/custom/kyles/frames/minimalist/pt/ptg.png', masks:ptMasks},
	{name:'Multicolored Power/Toughness Box', src:'/img/frames/custom/kyles/frames/minimalist/pt/ptgold.png', masks:ptMasks},
	{name:'Artifact Power/Toughness Box', src:'/img/frames/custom/kyles/frames/minimalist/pt/ptartifact.png', masks:ptMasks},
	{name:'Vehicle Power/Toughness Box', src:'/img/frames/custom/kyles/frames/minimalist/pt/ptvehicle.png', masks:ptMasks},

];
//disables/enables the "Load Frame Version" button
document.querySelector('#loadFrameVersion').disabled = false;
//defines process for loading this version, if applicable
document.querySelector('#loadFrameVersion').onclick = async function() {
	//resets things so that every frame doesn't have to
	await resetCardIrregularities();
	//sets card version
	card.version = 'customKylesMinimalist';


	loadScript('/js/frames/manaSymbolsCustomKylesMinimalist.js');

	//art bounds
	card.artBounds = {x:0, y:0, width:1, height:1};
	autoFitArt();
	//set symbol bounds
	card.setSymbolBounds = {x:0.9213, y:0.5910, width:0.12, height:0.0410, vertical:'center', horizontal: 'right'};
	resetSetSymbol();
	//watermark bounds
	card.watermarkBounds = {x:0.5, y:0.7762, width:0.75, height:0.2305};
	resetWatermark();
	//text
	loadTextOptions({
		mana: {name:'Mana Cost', text:'', x:85/cardWidth, y:1620/cardHeight, width:1850/cardWidth, height:89/cardHeight, oneLine:true, align:'left',  manaCost:true, manaSpacing:0, manaPrefix:'minimalist'},
		title: {name:'Title', text:'', x:85/cardWidth, y:1722/cardHeight, width:1850/cardWidth, height:89/cardHeight, oneLine:true, font:'belerenb', color:'white', align:'left'},
		type: {name:'Type', text:'', x:90/cardWidth, y:1823/cardHeight, width:1850/cardWidth, height:65/cardHeight, oneLine:true, font:'circularstd', color:'#ecd379', align:'left', size:0.02294,},
		rules: {name:'Rules Text', text:'', x:170/cardWidth, y:1965/cardHeight, width:1660/cardWidth, height:580/cardHeight,  color:'white', align:'left', size: '0.027'},
		pt: {name:'Power/Toughness', text:'', x:1648/cardWidth, y:2630/cardHeight, width:252/cardWidth, height:75/cardHeight, size:0.028, font:'belerenb', oneLine:true, color:'white'},
	});
}
//loads available frames
loadFramePack();
//Only for the main version as the webpage loads:
if (!card.text) {
	document.querySelector('#loadFrameVersion').click();
}