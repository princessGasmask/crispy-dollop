import { useEffect, useRef, useState } from 'react'
import { Activity, Crosshair, Dices, Heart, ImagePlus, Menu, Plus, Shield, Sparkles, Swords, Trash2, Upload, X, Zap } from 'lucide-react'
import { loadGameData, saveGameData } from './storage.js'

const seedFighters = [
  { id: 1, name: 'Mara Vex', title: 'The Night Courier', initials: 'MV', color: '#d5714e', portrait: null, grit: 8, wit: 6, luck: 4, trait: 'Quick on her feet', weapon: 'Twin Daggers' },
  { id: 2, name: 'Orion Pike', title: 'The Last Ranger', initials: 'OP', color: '#527f73', portrait: null, grit: 6, wit: 8, luck: 5, trait: 'Never misses twice', weapon: 'Longbow' },
  { id: 3, name: 'June Hollow', title: 'The Wild Card', initials: 'JH', color: '#b08b4f', portrait: null, grit: 5, wit: 5, luck: 9, trait: 'Fortune favors her', weapon: 'Smoke Bombs' },
]

const defaults = {
  fighters: seedFighters,
  customEvents: ['{winner} discovers an abandoned shelter.', '{winner} outsmarts {loser} at the river crossing.'],
  weapons: ['Twin Daggers', 'Longbow', 'Smoke Bombs'],
}

function Portrait({ fighter, size = 'large' }) {
  return <div className={`portrait ${size}`} style={{ '--accent': fighter.color }}>
    {fighter.portrait ? <img src={fighter.portrait} alt={fighter.name} /> : <span>{fighter.initials}</span>}
  </div>
}

function Stat({ icon: Icon, label, value, onChange }) {
  return <div className="stat"><div className="stat-label"><span><Icon size={13}/>{label}</span><b>{value}</b></div><input aria-label={label} type="range" min="1" max="10" value={value} onChange={e => onChange?.(+e.target.value)} /></div>
}

function App() {
  const [savedGame] = useState(() => loadGameData(defaults))
  const [fighters, setFighters] = useState(savedGame.fighters)
  const [selected, setSelected] = useState(0)
  const [activeTab, setActiveTab] = useState('Roster')
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState('')
  const [customEvents, setCustomEvents] = useState(savedGame.customEvents)
  const [weapons, setWeapons] = useState(savedGame.weapons)
  const [draft, setDraft] = useState('')
  const [battle, setBattle] = useState(null)
  const fileRef = useRef(null)
  const fighter = fighters[selected]

  useEffect(() => {
    if (saveGameData({ fighters, customEvents, weapons })) return undefined
    const warning = window.setTimeout(() => setToast('Browser storage is full — remove a large portrait and try again'), 0)
    return () => window.clearTimeout(warning)
  }, [fighters, customEvents, weapons])

  const update = (key, value) => setFighters(items => items.map((item, i) => i === selected ? { ...item, [key]: value, ...(key === 'name' ? { initials: value.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() } : {}) } : item))
  const addFighter = () => { const next = { id: Date.now(), name: 'New Contender', title: 'The Unknown', initials: 'NC', color: '#76678d', portrait: null, grit: 5, wit: 5, luck: 5, trait: 'Unwritten destiny', weapon: 'Bare Hands' }; setFighters([...fighters, next]); setSelected(fighters.length); setEditing(true) }
  const removeFighter = () => { if (fighters.length <= 2) return; setFighters(fighters.filter((_, i) => i !== selected)); setSelected(0) }
  const upload = e => {
    const file = e.target.files[0]
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 1_500_000) {
      setToast('Choose an image smaller than 1.5 MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => update('portrait', reader.result)
    reader.onerror = () => setToast('That portrait could not be read')
    reader.readAsDataURL(file)
  }
  const save = () => { setEditing(false); setToast('Contender saved to your roster'); setTimeout(() => setToast(''), 2500) }
  const addCreation = () => {
    if (!draft.trim()) return
    if (activeTab === 'Events') setCustomEvents([...customEvents, draft.trim()])
    else setWeapons([...weapons, draft.trim()])
    setDraft('')
  }
  const simulate = () => {
    const shuffled = [...fighters].sort(() => Math.random() - .5)
    const winner = shuffled[0]
    const log = shuffled.slice(1).map((loser, index) => {
      const template = customEvents[index % customEvents.length] || '{winner} defeats {loser} after a hard-fought encounter.'
      return template.replaceAll('{winner}', index === shuffled.length - 2 ? winner.name : shuffled[index + 1]?.name || winner.name).replaceAll('{loser}', loser.name)
    })
    setBattle({ winner, log })
  }

  return <div className="app-shell">
    <header>
      <button className="icon-button mobile"><Menu/></button>
      <a className="brand" href="#top" aria-label="Last One Standing home"><span className="brand-mark"><Swords size={20}/></span><span>LAST ONE <i>STANDING</i></span></a>
      <nav>{['Roster','Arsenal','Events'].map(tab => <button className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)} key={tab}>{tab}</button>)}</nav>
      <button className="ghost"><Upload size={15}/> Import</button>
      <button className="primary" onClick={simulate}><Dices size={17}/> Run simulation</button>
    </header>

    <main id="top">
      <section className="hero">
        <div><span className="eyebrow"><Sparkles size={13}/> ARENA ROSTER</span><h1>Choose your <em>contenders.</em></h1><p>Every legend starts somewhere. Create your cast, shape their strengths, and give them a fighting chance.</p></div>
        <div className="roster-count"><strong>{String(fighters.length).padStart(2,'0')}</strong><span>CONTENDERS<br/>READY</span></div>
      </section>

      {activeTab === 'Roster' ? <section className="workspace">
        <aside className="roster-panel">
          <div className="section-title"><span>YOUR ROSTER</span><small>{fighters.length} / 24</small></div>
          <div className="fighter-list">{fighters.map((item, i) => <button key={item.id} className={`fighter-row ${i === selected ? 'selected' : ''}`} onClick={() => {setSelected(i); setEditing(false)}}><Portrait fighter={item} size="small"/><span><b>{item.name}</b><small>{item.title}</small></span><i>0{i+1}</i></button>)}</div>
          <button className="add" onClick={addFighter}><Plus size={18}/> Add contender</button>
          <div className="roster-tip"><Zap size={17}/><p><b>Tip from the Gamemaker</b>Balanced stats make the best stories. Flaws are more fun than perfection.</p></div>
        </aside>

        <article className="profile-card">
          <div className="paper-noise" />
          <div className="profile-top">
            <div className="portrait-wrap"><Portrait fighter={fighter}/><button onClick={() => fileRef.current.click()} aria-label="Upload portrait"><ImagePlus size={16}/></button><input ref={fileRef} type="file" accept="image/*" onChange={upload}/></div>
            <div className="identity">
              <span className="number">CONTENDER // 0{selected+1}</span>
              {editing ? <><input className="name-input" value={fighter.name} onChange={e => update('name', e.target.value)}/><input className="title-input" value={fighter.title} onChange={e => update('title', e.target.value)}/></> : <><h2>{fighter.name}</h2><p>{fighter.title}</p></>}
              <div className="tag"><Activity size={13}/> ACTIVE ROSTER</div>
            </div>
            <div className="profile-actions"><button className="icon-button danger" onClick={removeFighter} aria-label="Delete contender"><Trash2 size={17}/></button><button className="outline" onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Edit profile'}</button></div>
          </div>

          <div className="rule"/>
          <div className="details-grid">
            <section><div className="section-title"><span>CORE STATS</span><small>30 POINT LIMIT</small></div><div className="stats"><Stat icon={Shield} label="GRIT" value={fighter.grit} onChange={v => update('grit',v)}/><Stat icon={Crosshair} label="WIT" value={fighter.wit} onChange={v => update('wit',v)}/><Stat icon={Heart} label="LUCK" value={fighter.luck} onChange={v => update('luck',v)}/></div></section>
            <section><div className="section-title"><span>SIGNATURE TRAIT</span></div><div className="trait-card"><Sparkles size={19}/><div>{editing ? <input value={fighter.trait} onChange={e => update('trait',e.target.value)}/> : <b>{fighter.trait}</b>}<p>Gains an advantage when the odds turn against them.</p></div></div></section>
          </div>
          <section className="loadout"><div className="section-title"><span>STARTING LOADOUT</span><button onClick={() => setToast('Arsenal opened — more weapons coming soon')}>Browse arsenal →</button></div><div className="weapon"><span><Swords/></span><div><small>EQUIPPED WEAPON</small>{editing ? <input value={fighter.weapon} onChange={e => update('weapon',e.target.value)}/> : <b>{fighter.weapon}</b>}</div><span className="rarity">UNCOMMON</span></div></section>
          {editing && <div className="savebar"><span>Make this contender your own.</span><button className="primary" onClick={save}>Save contender</button></div>}
        </article>
      </section> : <section className="workshop">
        <div className="workshop-head"><div><span className="eyebrow">CUSTOM {activeTab.toUpperCase()}</span><h2>{activeTab === 'Events' ? 'Write the possibilities.' : 'Forge the arsenal.'}</h2><p>{activeTab === 'Events' ? 'Use {winner} and {loser} as character placeholders in your story events.' : 'Create unique equipment, then assign it from any contender profile.'}</p></div><span>{activeTab === 'Events' ? customEvents.length : weapons.length} CREATED</span></div>
        <div className="creation-row"><input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCreation()} placeholder={activeTab === 'Events' ? '{winner} ambushes {loser} beneath the old bridge…' : 'Name a new weapon…'}/><button className="primary" onClick={addCreation}><Plus size={16}/> Add {activeTab === 'Events' ? 'event' : 'weapon'}</button></div>
        <div className="creation-list">{(activeTab === 'Events' ? customEvents : weapons).map((item, i) => <div key={`${item}-${i}`}><span>0{i+1}</span><p>{item}</p><button onClick={() => activeTab === 'Events' ? setCustomEvents(customEvents.filter((_, n) => n !== i)) : setWeapons(weapons.filter((_, n) => n !== i))}><Trash2 size={16}/></button></div>)}</div>
      </section>}
      <footer><span>THE ARENA AWAITS</span><p>Build your roster. Write their fate.</p><span>EST. MMXXIV</span></footer>
    </main>
    {toast && <div className="toast"><Sparkles size={16}/>{toast}<button onClick={() => setToast('')}><X size={15}/></button></div>}
    {battle && <div className="modal-backdrop" onClick={() => setBattle(null)}><section className="battle-modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setBattle(null)}><X/></button><span className="eyebrow"><Swords size={14}/> ARENA REPORT</span><h2>{battle.winner.name} stands alone.</h2><p className="winner-title">{battle.winner.title} wins with {battle.winner.weapon}.</p><div className="battle-log">{battle.log.map((line, i) => <p key={i}><span>ROUND {String(i+1).padStart(2,'0')}</span>{line}</p>)}</div><button className="primary" onClick={simulate}><Dices size={16}/> Simulate again</button></section></div>}
  </div>
}

export default App
