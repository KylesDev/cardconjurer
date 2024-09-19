//Create objects for common properties across available frames
var cardWidth = 2192;
var cardHeight = 2992;
var masks = [];
var ptBounds = {x:1630/cardWidth, y:2724/cardHeight, width:247/cardWidth, height:80/cardHeight};
var bounds = {x:0.7573, y:0.8848, width:0.188, height:0.0733};
//defines available frames
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

	{name:'White Power/Toughness Box', src:'/img/frames/custom/kyles/frames/minimalist/pt/pt.png', bounds:ptBounds},

];
//disables/enables the "Load Frame Version" button
document.querySelector('#loadFrameVersion').disabled = false;
//defines process for loading this version, if applicable
document.querySelector('#loadFrameVersion').onclick = async function() {
	//resets things so that every frame doesn't have to
	await resetCardIrregularities();
	//sets card version
	card.version = 'customKylesMinimalistBleed';


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
		mana: {name:'Mana Cost', text:'', x:184/cardWidth, y:1738/cardHeight, width:1824/cardWidth, height:95/cardHeight, oneLine:true, align:'left',  manaCost:true, manaSpacing:0, manaPrefix:'minimalist'},
		title: {name:'Title', text:'', x:184/cardWidth, y:1848/cardHeight, width:1824/cardWidth, height:95/cardHeight, oneLine:true, font:'belerenb', color:'white', align:'left'},
		type: {name:'Type', text:'', x:184/cardWidth, y:1956/cardHeight, width:1824/cardWidth, height:70/cardHeight, oneLine:true, font:'circularstd', color:'#ecd379', align:'left', size:0.02462,},
		rules: {name:'Rules Text', text:'', x:235/cardWidth, y:2050/cardHeight, width:1693/cardWidth, height:665/cardHeight, size:0.0362, color:'white', align:'left', font:'mplantin'},
		pt: {name:'Power/Toughness', text:'', x:1713/cardWidth, y:2734/cardHeight, width:270/cardWidth, height:80/cardHeight, size:0.030, font:'belerenb', oneLine:true, color:'white'},
	});
}
//loads available frames
loadFramePack();
//Only for the main version as the webpage loads:
if (!card.text) {
	document.querySelector('#loadFrameVersion').click();
}