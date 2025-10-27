//Create objects for common properties across available frames
var masks = [{src:'/img/frames/storybook/borderless/TitleMask.png', name:'Title'}, {src:'/img/frames/storybook/borderless/TypeMask.png', name:'Type'}, {src:'/img/frames/storybook/borderless/RulesMask.png', name:'Rules'}, {src:'/img/frames/storybook/borderless/FrameMask.png', name:'Frame'}];
//Create objects for common properties across available frames
var bounds = {x:1165/1500, y:1860/2100, width:266/1500, height:134/2100};
var crownBounds = {x:80/1500, y:41/2100, width:1341/1500, height:73/2100};
//defines available frames
availableFrames = [
	{name:'White Frame', src:'/img/frames/storybook/borderless/seethrough/w.png', masks:masks}, 
	{name:'Blue Frame', src:'/img/frames/storybook/borderless/seethrough/u.png', masks:masks},
	{name:'Black Frame', src:'/img/frames/storybook/borderless/seethrough/b.png', masks:masks},
	{name:'Red Frame', src:'/img/frames/storybook/borderless/seethrough/r.png', masks:masks},
	{name:'Green Frame', src:'/img/frames/storybook/borderless/seethrough/g.png', masks:masks},
	{name:'Multicolored Frame', src:'/img/frames/storybook/borderless/seethrough/m.png', masks:masks},

	{name:'White Power/Toughness', src:'/img/frames/storybook/mul/pt/w.png', bounds:bounds},
	{name:'Blue Power/Toughness', src:'/img/frames/storybook/mul/pt/u.png', bounds:bounds},
	{name:'Black Power/Toughness', src:'/img/frames/storybook/mul/pt/b.png', bounds:bounds},
	{name:'Red Power/Toughness', src:'/img/frames/storybook/mul/pt/r.png', bounds:bounds},
	{name:'Green Power/Toughness', src:'/img/frames/storybook/mul/pt/g.png', bounds:bounds},
	{name:'Multicolored Power/Toughness', src:'/img/frames/storybook/mul/pt/m.png', bounds:bounds},

	{name:'White Legend Crown', src:'/img/frames/storybook/mul/crowns/w.png', bounds:crownBounds},
	{name:'Blue Legend Crown', src:'/img/frames/storybook/mul/crowns/u.png', bounds:crownBounds},
	{name:'Black Legend Crown', src:'/img/frames/storybook/mul/crowns/b.png', bounds:crownBounds},
	{name:'Red Legend Crown', src:'/img/frames/storybook/mul/crowns/r.png', bounds:crownBounds},
	{name:'Green Legend Crown', src:'/img/frames/storybook/mul/crowns/g.png', bounds:crownBounds},
	{name:'Multicolored Legend Crown', src:'/img/frames/storybook/mul/crowns/m.png', bounds:crownBounds},
	

	{name:'Holo Stamp', src:'/img/frames/storybook/holo.png', bounds:{x:679/1500, y:0.9129, width:0.0987, height:0.0386}},
];
//disables/enables the "Load Frame Version" button
document.querySelector('#loadFrameVersion').disabled = false;
//defines process for loading this version, if applicable
document.querySelector('#loadFrameVersion').onclick = async function() {
	//resets things so that every frame doesn't have to
	await resetCardIrregularities();
	//sets card version
	card.version = 'storybook_woe';
	card.showsFlavorBar = false;
	//art bounds
	card.artBounds = {x:0, y:0, width:1, height:1};
	autoFitArt();
	//set symbol bounds
	card.setSymbolBounds = {x:0.9213, y:0.6660, width:0.12, height:0.0410, vertical:'center', horizontal: 'right'};
	resetSetSymbol();
	//watermark bounds
	card.watermarkBounds = {x:0.72, y:0.7681, width:0.3867, height:0.2358};
	resetWatermark();
	//text
	loadTextOptions({
		mana: {name:'Mana Cost', text:'', x:-0.008 , y:0.063, width:0.9292, height:71/2100, oneLine:true, size:71/1638, align:'right', shadowX:-0.001, shadowY:0.0029, manaCost:true, manaSpacing:0},
		title: {name:'Title', text:'', x:0.098, y:0.0522, width:0.8292, height:0.0543, oneLine:true, font:'belerenb', size:0.0381, color:'white', shadowX:0.0018, shadowY:0.002},
		type: {name:'Type', text:'', x:0.095, y:0.6400, width:0.8310, height:0.0543, oneLine:true, font:'belerenb', size:0.0324, color:'white', shadowX:0.0018, shadowY:0.002},
		rules: {name:'Rules Text', text:'', x:0.099, y:0.7180, width:0.80, height:0.19, size:0.0362, color:'white', shadowX:0.0018, shadowY:0.002},
		pt: {name:'Power/Toughness', text:'', x:0.7928, y:0.902, width:0.1367, height:0.0372, size:0.0372, font:'belerenbsc', oneLine:true, align:'center'}
	});
}
//loads available frames
loadFramePack();
//Only for the main version as the webpage loads:
if (!card.text) {
	document.querySelector('#loadFrameVersion').click();
}