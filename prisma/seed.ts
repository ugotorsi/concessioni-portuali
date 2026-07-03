import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import type { RuoloUser } from "../src/generated/prisma/enums";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Configure a PostgreSQL connection string in your environment.");
}

const pool = new Pool({ connectionString: databaseUrl });

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

const dayMs = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * dayMs);
const daysAgo = (days: number) => new Date(Date.now() - days * dayMs);

async function clearDemoData() {
  await prisma.normaImpatto.deleteMany();
  await prisma.normaVersione.deleteMany();
  await prisma.normaFonte.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.report.deleteMany();
  await prisma.documento.deleteMany();
  await prisma.pagamento.deleteMany();
  await prisma.sopralluogo.deleteMany();
  await prisma.procedimento.deleteMany();
  await prisma.criticita.deleteMany();
  await prisma.scadenza.deleteMany();
  await prisma.obbligoConcessorio.deleteMany();
  await prisma.concessione.deleteMany();
  await prisma.concessionario.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  await clearDemoData();

  const demoCredentials: Array<{
    nome: string;
    email: string;
    role: RuoloUser;
    password: string;
  }> = [
    { nome: "Admin Demo", email: "admin@demo.local", role: "ADMIN", password: "admin123" },
    {
      nome: "Operatore Demo",
      email: "operatore@demo.local",
      role: "OPERATORE_SOCIETA",
      password: "operatore123",
    },
    {
      nome: "Giuridico Demo",
      email: "giuridico@demo.local",
      role: "GIURIDICO",
      password: "giuridico123",
    },
    { nome: "Tecnico Demo", email: "tecnico@demo.local", role: "TECNICO", password: "tecnico123" },
    {
      nome: "Economico Demo",
      email: "economico@demo.local",
      role: "ECONOMICO",
      password: "economico123",
    },
    {
      nome: "Viewer AdSP Demo",
      email: "adsp@demo.local",
      role: "VIEWER_ADSP",
      password: "adsp123",
    },
    {
      nome: "Admin Legacy Demo",
      email: "admin.demo@concessioni.local",
      role: "ADMIN",
      password: "admin123",
    },
    {
      nome: "Project Manager Demo",
      email: "pm.demo@concessioni.local",
      role: "PROJECT_MANAGER",
      password: "pm123",
    },
    {
      nome: "Giuridico Legacy Demo",
      email: "giuridico.demo@concessioni.local",
      role: "GIURIDICO",
      password: "giuridico123",
    },
    {
      nome: "Tecnico Legacy Demo",
      email: "tecnico.demo@concessioni.local",
      role: "TECNICO",
      password: "tecnico123",
    },
    {
      nome: "Economico Legacy Demo",
      email: "economico.demo@concessioni.local",
      role: "ECONOMICO",
      password: "economico123",
    },
    {
      nome: "Viewer AdSP Legacy Demo",
      email: "viewer.adsp.demo@concessioni.local",
      role: "VIEWER_ADSP",
      password: "adsp123",
    },
  ];

  const hashedCredentials = await Promise.all(
    demoCredentials.map(async (item) => ({
      nome: item.nome,
      email: item.email,
      ruolo: item.role,
      passwordHash: await bcrypt.hash(item.password, 10),
    })),
  );

  await prisma.user.createMany({
    data: hashedCredentials,
  });

  const users = await prisma.user.findMany();
  const userByEmail = Object.fromEntries(users.map((item) => [item.email, item.id]));

  const concessionariData = [
    {
      key: "terminal-servizi",
      denominazione: "Terminal Servizi Costieri S.r.l.",
      codiceFiscale: "TSCM1200451X",
      partitaIva: "01234000123",
      sedeLegale: "Via del Bacino 12, Porto Levante",
      pec: "terminal.servizi@pec.demo",
      legaleRappresentante: "Rappresentante Demo A",
      telefono: "+39 070 300100",
      email: "segreteria@terminalservizicostieri.demo",
      note: "Operatore storico area commerciale molo nord.",
    },
    {
      key: "approdi-tirrenici",
      denominazione: "Approdi Tirrenici S.r.l.",
      codiceFiscale: "ATRM9800345Y",
      partitaIva: "02245000154",
      sedeLegale: "Lungomare Dogana 5, Porto Tirreno",
      pec: "approdi.tirrenici@pec.demo",
      legaleRappresentante: "Rappresentante Demo B",
      telefono: "+39 056 410220",
      email: "info@approditirrenici.demo",
      note: "Gestione specchi acquei e pontili turistici.",
    },
    {
      key: "marina-operations",
      denominazione: "Marina Operations S.r.l.",
      codiceFiscale: "MOPX7700789K",
      partitaIva: "03156000876",
      sedeLegale: "Piazzale Darsena 44, Porto Marina",
      pec: "marina.operations@pec.demo",
      legaleRappresentante: "Rappresentante Demo C",
      telefono: "+39 099 500404",
      email: "ufficio@marinaoperations.demo",
      note: "Concessioni miste servizi passeggeri e supporto cantieri.",
    },
    {
      key: "logistica-molo-sud",
      denominazione: "Logistica Molo Sud S.r.l.",
      codiceFiscale: "LMSA8800114Q",
      partitaIva: "04123000665",
      sedeLegale: "Viale Molo Sud 1, Porto Centrale",
      pec: "logistica.molosud@pec.demo",
      legaleRappresentante: "Rappresentante Demo D",
      telefono: "+39 081 701200",
      email: "amministrazione@logisticamolosud.demo",
      note: "Concessionario area retrobanchina ad uso logistico.",
    },
    {
      key: "cantieri-porto-nuovo",
      denominazione: "Cantieri Porto Nuovo S.r.l.",
      codiceFiscale: "CPND9300987R",
      partitaIva: "05234000991",
      sedeLegale: "Via Officine 7, Porto Nuovo",
      pec: "cantieri.portonuovo@pec.demo",
      legaleRappresentante: "Rappresentante Demo E",
      telefono: "+39 010 812233",
      email: "direzione@cantieriportonuovo.demo",
      note: "Concessioni dedicate a cantieristica e manutenzioni navali.",
    },
  ];

  const concessionariByKey: Record<string, string> = {};
  for (const item of concessionariData) {
    const created = await prisma.concessionario.create({
      data: {
        denominazione: item.denominazione,
        codiceFiscale: item.codiceFiscale,
        partitaIva: item.partitaIva,
        sedeLegale: item.sedeLegale,
        pec: item.pec,
        legaleRappresentante: item.legaleRappresentante,
        telefono: item.telefono,
        email: item.email,
        note: item.note,
      },
    });
    concessionariByKey[item.key] = created.id;
  }

  const concessioniData = [
    {
      key: "con-001",
      numeroAtto: "CP-001/2021",
      dataRilascio: new Date("2021-02-15"),
      dataScadenza: daysFromNow(45),
      normaRiferimento: "ART_18_L_84_1994",
      tipologiaBene: "AREA_SCOPERTA",
      attivita: "LOGISTICA",
      superficieMq: "12000.00",
      coordinateGis: "41.214,12.501",
      canoneAnnuo: "145000.00",
      categoriaCanone: "C1",
      stato: "ATTIVA",
      descrizioneBene: "Area scoperta retrobanchina settore nord",
      ubicazione: "Molo Nord - Lotto A",
      note: "Attivita di stoccaggio temporaneo merci.",
      concessionarioKey: "logistica-molo-sud",
    },
    {
      key: "con-002",
      numeroAtto: "CP-014/2020",
      dataRilascio: new Date("2020-07-01"),
      dataScadenza: daysFromNow(25),
      normaRiferimento: "ART_36_COD_NAV",
      tipologiaBene: "BANCHINA",
      attivita: "COMMERCIALE",
      superficieMq: "3200.00",
      coordinateGis: "41.220,12.496",
      canoneAnnuo: "212000.00",
      categoriaCanone: "B2",
      stato: "IN_PROROGA",
      descrizioneBene: "Tratto banchina per operazioni carico/scarico",
      ubicazione: "Banchina Est - Sezione 3",
      note: "Proroga tecnica in attesa nuova procedura.",
      concessionarioKey: "terminal-servizi",
    },
    {
      key: "con-003",
      numeroAtto: "CP-031/2017",
      dataRilascio: new Date("2017-09-20"),
      dataScadenza: daysAgo(20),
      normaRiferimento: "ART_36_COD_NAV",
      tipologiaBene: "SPECCHIO_ACQUEO",
      attivita: "TURISTICO_RICREATIVA",
      superficieMq: "6400.00",
      coordinateGis: "41.229,12.510",
      canoneAnnuo: "98000.00",
      categoriaCanone: "S3",
      stato: "SCADUTA",
      descrizioneBene: "Specchio acqueo per ormeggio turistico",
      ubicazione: "Darsena Turistica Ovest",
      note: "Scadenza raggiunta in data recente.",
      concessionarioKey: "approdi-tirrenici",
    },
    {
      key: "con-004",
      numeroAtto: "CP-046/2022",
      dataRilascio: new Date("2022-04-11"),
      dataScadenza: daysFromNow(180),
      normaRiferimento: "ART_18_L_84_1994",
      tipologiaBene: "BOX",
      attivita: "SERVIZI_PORTUALI",
      superficieMq: "420.00",
      coordinateGis: "41.217,12.494",
      canoneAnnuo: "28500.00",
      categoriaCanone: "D1",
      stato: "ATTIVA",
      descrizioneBene: "Box tecnico per supporto mezzi di banchina",
      ubicazione: "Varco Sud - Area Servizi",
      note: "Concessione con obbligo manutentivo semestrale.",
      concessionarioKey: "marina-operations",
    },
    {
      key: "con-005",
      numeroAtto: "CP-058/2019",
      dataRilascio: new Date("2019-12-05"),
      dataScadenza: daysFromNow(80),
      normaRiferimento: "ART_36_COD_NAV",
      tipologiaBene: "LOCALE",
      attivita: "PASSEGGERI",
      superficieMq: "780.00",
      coordinateGis: "41.226,12.489",
      canoneAnnuo: "63000.00",
      categoriaCanone: "P2",
      stato: "SOSPESA",
      descrizioneBene: "Locale servizi passeggeri area imbarchi",
      ubicazione: "Terminal Passeggeri - Piano terra",
      note: "Sospensione temporanea per adeguamenti impiantistici.",
      concessionarioKey: "marina-operations",
    },
    {
      key: "con-006",
      numeroAtto: "CP-067/2018",
      dataRilascio: new Date("2018-03-28"),
      dataScadenza: daysAgo(120),
      normaRiferimento: "ART_18_L_84_1994",
      tipologiaBene: "MANUFATTO",
      attivita: "CANTIERISTICA",
      superficieMq: "2150.00",
      coordinateGis: "41.233,12.502",
      canoneAnnuo: "117000.00",
      categoriaCanone: "M4",
      stato: "SCADUTA",
      descrizioneBene: "Manufatto coperto per lavorazioni leggere",
      ubicazione: "Area Cantieri - Capannone 2",
      note: "Posizione con pendenze documentali.",
      concessionarioKey: "cantieri-porto-nuovo",
    },
    {
      key: "con-007",
      numeroAtto: "CP-073/2023",
      dataRilascio: new Date("2023-05-09"),
      dataScadenza: daysFromNow(65),
      normaRiferimento: "ART_36_COD_NAV",
      tipologiaBene: "MOLO",
      attivita: "COMMERCIALE",
      superficieMq: "5100.00",
      coordinateGis: "41.240,12.515",
      canoneAnnuo: "198000.00",
      categoriaCanone: "B3",
      stato: "IN_PROROGA",
      descrizioneBene: "Molo operativo per traffico ro-ro",
      ubicazione: "Molo Sud - Testata",
      note: "Concessione in monitoraggio rafforzato.",
      concessionarioKey: "terminal-servizi",
    },
    {
      key: "con-008",
      numeroAtto: "CP-081/2024",
      dataRilascio: new Date("2024-01-17"),
      dataScadenza: daysFromNow(240),
      normaRiferimento: "ALTRO",
      tipologiaBene: "ALTRO",
      attivita: "ALTRO",
      superficieMq: "950.00",
      coordinateGis: "41.212,12.487",
      canoneAnnuo: "36000.00",
      categoriaCanone: "A9",
      stato: "ATTIVA",
      descrizioneBene: "Area attrezzata multifunzione",
      ubicazione: "Comparto Ovest - Lotto sperimentale",
      note: "Altra area destinata a servizi complementari.",
      concessionarioKey: "approdi-tirrenici",
    },
  ] as const;

  const concessioniByKey: Record<string, string> = {};
  for (const item of concessioniData) {
    const created = await prisma.concessione.create({
      data: {
        numeroAtto: item.numeroAtto,
        dataRilascio: item.dataRilascio,
        dataScadenza: item.dataScadenza,
        normaRiferimento: item.normaRiferimento,
        tipologiaBene: item.tipologiaBene,
        attivita: item.attivita,
        superficieMq: item.superficieMq,
        coordinateGis: item.coordinateGis,
        canoneAnnuo: item.canoneAnnuo,
        categoriaCanone: item.categoriaCanone,
        stato: item.stato,
        descrizioneBene: item.descrizioneBene,
        ubicazione: item.ubicazione,
        note: item.note,
        concessionarioId: concessionariByKey[item.concessionarioKey],
      },
    });
    concessioniByKey[item.key] = created.id;
  }

  await prisma.obbligoConcessorio.createMany({
    data: [
      {
        concessioneId: concessioniByKey["con-001"],
        tipologia: "PAGAMENTO_CANONE",
        fonte: "Atto concessorio art. 8",
        descrizione: "Versamento canone annuale entro il 31 marzo.",
        frequenza: "ANNUALE",
        dataProssimaVerifica: daysFromNow(20),
        stato: "DA_VERIFICARE",
      },
      {
        concessioneId: concessioniByKey["con-001"],
        tipologia: "SICUREZZA",
        fonte: "Piano sicurezza porto",
        descrizione: "Aggiornamento registro formazione addetti.",
        frequenza: "SEMESTRALE",
        dataProssimaVerifica: daysFromNow(50),
        stato: "ADEMPIUTO",
      },
      {
        concessioneId: concessioniByKey["con-002"],
        tipologia: "MANUTENZIONE",
        fonte: "Prescrizione tecnica n. 12",
        descrizione: "Ripristino parabordi tratto est.",
        frequenza: "TRIMESTRALE",
        dataProssimaVerifica: daysFromNow(15),
        stato: "INADEMPIUTO",
      },
      {
        concessioneId: concessioniByKey["con-002"],
        tipologia: "POLIZZA",
        fonte: "Atto concessorio art. 14",
        descrizione: "Rinnovo polizza RCT e deposito copia aggiornata.",
        frequenza: "ANNUALE",
        dataProssimaVerifica: daysFromNow(30),
        stato: "DA_VERIFICARE",
      },
      {
        concessioneId: concessioniByKey["con-003"],
        tipologia: "GARANZIA",
        fonte: "Atto concessorio art. 15",
        descrizione: "Mantenimento fideiussione bancaria attiva.",
        frequenza: "ANNUALE",
        dataProssimaVerifica: daysAgo(25),
        stato: "INADEMPIUTO",
      },
      {
        concessioneId: concessioniByKey["con-003"],
        tipologia: "USO_DIRETTO",
        fonte: "Clausola uso diretto",
        descrizione: "Divieto di utilizzo da parte di terzi non autorizzati.",
        frequenza: "CONTINUA",
        dataProssimaVerifica: daysFromNow(12),
        stato: "PARZIALMENTE_ADEMPIUTO",
      },
      {
        concessioneId: concessioniByKey["con-004"],
        tipologia: "DOCUMENTAZIONE_PERIODICA",
        fonte: "Regolamento demanio interno",
        descrizione: "Invio trimestrale registro utilizzo box.",
        frequenza: "TRIMESTRALE",
        dataProssimaVerifica: daysFromNow(10),
        stato: "ADEMPIUTO",
      },
      {
        concessioneId: concessioniByKey["con-004"],
        tipologia: "PRESCRIZIONI_TECNICHE",
        fonte: "Verbale sopralluogo 07/2026",
        descrizione: "Adeguamento impianto antincendio locale tecnico.",
        frequenza: "UNA_TANTUM",
        dataProssimaVerifica: daysFromNow(35),
        stato: "DA_VERIFICARE",
      },
      {
        concessioneId: concessioniByKey["con-005"],
        tipologia: "SICUREZZA",
        fonte: "Atto concessorio art. 9",
        descrizione: "Aggiornamento piano emergenza terminal passeggeri.",
        frequenza: "ANNUALE",
        dataProssimaVerifica: daysFromNow(40),
        stato: "PARZIALMENTE_ADEMPIUTO",
      },
      {
        concessioneId: concessioniByKey["con-005"],
        tipologia: "PAGAMENTO_CANONE",
        fonte: "Atto concessorio art. 11",
        descrizione: "Regolarizzazione canone sospeso in due rate.",
        frequenza: "ANNUALE",
        dataProssimaVerifica: daysAgo(10),
        stato: "INADEMPIUTO",
      },
      {
        concessioneId: concessioniByKey["con-006"],
        tipologia: "DOCUMENTAZIONE_PERIODICA",
        fonte: "Circolare monitoraggio cantieri",
        descrizione: "Deposito relazione tecnica semestrale.",
        frequenza: "SEMESTRALE",
        dataProssimaVerifica: daysAgo(50),
        stato: "INADEMPIUTO",
      },
      {
        concessioneId: concessioniByKey["con-006"],
        tipologia: "MANUTENZIONE",
        fonte: "Atto concessorio art. 16",
        descrizione: "Ripristino copertura manufatto e lattonerie.",
        frequenza: "ANNUALE",
        dataProssimaVerifica: daysFromNow(28),
        stato: "DA_VERIFICARE",
      },
      {
        concessioneId: concessioniByKey["con-007"],
        tipologia: "POLIZZA",
        fonte: "Atto concessorio art. 13",
        descrizione: "Rinnovo polizza danni a terzi per operazioni ro-ro.",
        frequenza: "ANNUALE",
        dataProssimaVerifica: daysFromNow(7),
        stato: "DA_VERIFICARE",
      },
      {
        concessioneId: concessioniByKey["con-007"],
        tipologia: "GARANZIA",
        fonte: "Clausola cauzionale",
        descrizione: "Conferma validita garanzia a prima richiesta.",
        frequenza: "ANNUALE",
        dataProssimaVerifica: daysFromNow(45),
        stato: "ADEMPIUTO",
      },
      {
        concessioneId: concessioniByKey["con-008"],
        tipologia: "USO_DIRETTO",
        fonte: "Articolo uso area multifunzione",
        descrizione: "Divieto di subutilizzo non autorizzato dell area.",
        frequenza: "CONTINUA",
        dataProssimaVerifica: daysFromNow(60),
        stato: "ADEMPIUTO",
      },
      {
        concessioneId: concessioniByKey["con-008"],
        tipologia: "PRESCRIZIONI_TECNICHE",
        fonte: "Verbale tecnico 03/2026",
        descrizione: "Installazione segnaletica orizzontale area mezzi.",
        frequenza: "UNA_TANTUM",
        dataProssimaVerifica: daysFromNow(22),
        stato: "PARZIALMENTE_ADEMPIUTO",
      },
    ],
  });

  await prisma.scadenza.createMany({
    data: [
      {
        concessioneId: concessioniByKey["con-001"],
        tipologia: "CONCESSIONE",
        dataScadenza: daysFromNow(45),
        preavvisoGiorni: 60,
        stato: "APERTA",
        descrizione: "Scadenza titolo concessorio CP-001/2021.",
      },
      {
        concessioneId: concessioniByKey["con-002"],
        tipologia: "PAGAMENTO_CANONE",
        dataScadenza: daysFromNow(12),
        preavvisoGiorni: 30,
        stato: "APERTA",
        descrizione: "Seconda rata canone annuale 2026.",
      },
      {
        concessioneId: concessioniByKey["con-003"],
        tipologia: "POLIZZA",
        dataScadenza: daysAgo(8),
        preavvisoGiorni: 30,
        stato: "SCADUTA",
        descrizione: "Polizza RCT non rinnovata.",
      },
      {
        concessioneId: concessioniByKey["con-003"],
        tipologia: "FIDEIUSSIONE",
        dataScadenza: daysAgo(28),
        preavvisoGiorni: 45,
        stato: "SCADUTA",
        descrizione: "Fideiussione bancaria in attesa rinnovo.",
      },
      {
        concessioneId: concessioniByKey["con-004"],
        tipologia: "VERIFICA_PERIODICA",
        dataScadenza: daysFromNow(30),
        preavvisoGiorni: 15,
        stato: "APERTA",
        descrizione: "Verifica trimestrale stato impianti box.",
      },
      {
        concessioneId: concessioniByKey["con-005"],
        tipologia: "SOPRALLUOGO",
        dataScadenza: daysFromNow(60),
        preavvisoGiorni: 20,
        stato: "APERTA",
        descrizione: "Sopralluogo di controllo area passeggeri.",
      },
      {
        concessioneId: concessioniByKey["con-006"],
        tipologia: "TERMINE_PROCEDIMENTALE",
        dataScadenza: daysFromNow(18),
        preavvisoGiorni: 10,
        stato: "APERTA",
        descrizione: "Termine controdeduzioni procedimento diffida.",
      },
      {
        concessioneId: concessioniByKey["con-006"],
        tipologia: "CAUZIONE",
        dataScadenza: daysAgo(40),
        preavvisoGiorni: 30,
        stato: "SCADUTA",
        descrizione: "Cauzione non aggiornata dopo adeguamento canone.",
      },
      {
        concessioneId: concessioniByKey["con-007"],
        tipologia: "CONCESSIONE",
        dataScadenza: daysFromNow(65),
        preavvisoGiorni: 90,
        stato: "APERTA",
        descrizione: "Fine proroga tecnica molo sud.",
      },
      {
        concessioneId: concessioniByKey["con-007"],
        tipologia: "POLIZZA",
        dataScadenza: daysFromNow(7),
        preavvisoGiorni: 20,
        stato: "APERTA",
        descrizione: "Rinnovo polizza responsabilita operativa.",
      },
      {
        concessioneId: concessioniByKey["con-008"],
        tipologia: "PAGAMENTO_CANONE",
        dataScadenza: daysFromNow(90),
        preavvisoGiorni: 30,
        stato: "APERTA",
        descrizione: "Canone annuale area multifunzione.",
      },
      {
        concessioneId: concessioniByKey["con-002"],
        tipologia: "TERMINE_ADEMPIMENTO",
        dataScadenza: daysAgo(3),
        preavvisoGiorni: 15,
        stato: "SCADUTA",
        descrizione: "Adeguamento parabordi prescritto da verbale tecnico.",
      },
    ],
  });

  const pagamentoRows = [
    { concessioneKey: "con-001", anno: 2024, dovuto: "142000.00", versato: "142000.00", offset: -420, stato: "PAGATO", interessi: null, note: "Saldo nei termini." },
    { concessioneKey: "con-001", anno: 2025, dovuto: "145000.00", versato: "120000.00", offset: -120, stato: "PARZIALE", interessi: "2300.00", note: "Residuo in piano di rientro." },
    { concessioneKey: "con-001", anno: 2026, dovuto: "145000.00", versato: "0.00", offset: 12, stato: "NON_PAGATO", interessi: null, note: "Scadenza imminente con alert inviato." },
    { concessioneKey: "con-002", anno: 2024, dovuto: "210000.00", versato: "210000.00", offset: -500, stato: "PAGATO", interessi: null, note: "Regolare." },
    { concessioneKey: "con-002", anno: 2025, dovuto: "212000.00", versato: "170000.00", offset: -200, stato: "PARZIALE", interessi: "3150.00", note: "Mancato versamento rata finale." },
    { concessioneKey: "con-002", anno: 2026, dovuto: "212000.00", versato: "0.00", offset: -10, stato: "SCADUTO", interessi: "980.00", note: "Morosita avviata a recupero." },
    { concessioneKey: "con-003", anno: 2024, dovuto: "96000.00", versato: "96000.00", offset: -470, stato: "PAGATO", interessi: null, note: "Pagato." },
    { concessioneKey: "con-003", anno: 2025, dovuto: "98000.00", versato: "98000.00", offset: -130, stato: "PAGATO", interessi: null, note: "Pagato." },
    { concessioneKey: "con-003", anno: 2026, dovuto: "98000.00", versato: "20000.00", offset: -35, stato: "SCADUTO", interessi: "2100.00", note: "Morosita significativa." },
    { concessioneKey: "con-006", anno: 2024, dovuto: "113000.00", versato: "113000.00", offset: -430, stato: "PAGATO", interessi: null, note: "Pagato." },
    { concessioneKey: "con-006", anno: 2025, dovuto: "117000.00", versato: "50000.00", offset: -160, stato: "PARZIALE", interessi: "2700.00", note: "Morosita in aumento." },
    { concessioneKey: "con-006", anno: 2026, dovuto: "117000.00", versato: "0.00", offset: -60, stato: "SCADUTO", interessi: "3500.00", note: "Morosita grave con sollecito inviato." },
  ] as const;

  for (const item of pagamentoRows) {
    await prisma.pagamento.create({
      data: {
        concessioneId: concessioniByKey[item.concessioneKey],
        annoRiferimento: item.anno,
        importoDovuto: item.dovuto,
        importoVersato: item.versato,
        dataScadenza: daysFromNow(item.offset),
        dataVersamento: item.stato === "PAGATO" || item.stato === "PARZIALE" ? daysFromNow(item.offset - 8) : null,
        stato: item.stato,
        interessiMora: item.interessi,
        note: item.note,
      },
    });
  }

  await prisma.documento.createMany({
    data: [
      { concessioneId: concessioniByKey["con-001"], nome: "Titolo concessorio CP-001/2021", tipologia: "TITOLO_CONCESSORIO", url: "/demo/documenti/titolo-concessorio-001.pdf", dataDocumento: daysAgo(1800), descrizione: "Atto principale concessione area scoperta." },
      { concessioneId: concessioniByKey["con-001"], nome: "Planimetria lotto A", tipologia: "PLANIMETRIA", url: "/demo/documenti/planimetria-lotto-a.pdf", dataDocumento: daysAgo(800), descrizione: "Perimetrazione area in concessione." },
      { concessioneId: concessioniByKey["con-001"], nome: "Ricevuta canone 2024", tipologia: "PAGAMENTO", url: "/demo/documenti/pagamento-canone-2024-con001.pdf", dataDocumento: daysAgo(420), descrizione: "Quietanza annualita 2024." },
      { concessioneId: concessioniByKey["con-002"], nome: "Titolo concessorio CP-014/2020", tipologia: "TITOLO_CONCESSORIO", url: "/demo/documenti/titolo-concessorio-014.pdf", dataDocumento: daysAgo(2100), descrizione: "Atto rilascio tratto banchina." },
      { concessioneId: concessioniByKey["con-002"], nome: "Polizza RCT 2026", tipologia: "POLIZZA", url: "/demo/documenti/polizza-rct-2026-con002.pdf", dataDocumento: daysAgo(30), descrizione: "In corso verifica validita." },
      { concessioneId: concessioniByKey["con-002"], nome: "Verbale tecnico parabordi", tipologia: "VERBALE", url: "/demo/documenti/verbale-tecnico-parabordi.pdf", dataDocumento: daysAgo(20), descrizione: "Rilievi manutentivi su banchina." },
      { concessioneId: concessioniByKey["con-003"], nome: "Fideiussione bancaria", tipologia: "FIDEIUSSIONE", url: "/demo/documenti/fideiussione-con003.pdf", dataDocumento: daysAgo(390), descrizione: "Garanzia in scadenza." },
      { concessioneId: concessioniByKey["con-003"], nome: "Nota ufficio concessioni", tipologia: "NOTA", url: "/demo/documenti/nota-ufficio-con003.pdf", dataDocumento: daysAgo(18), descrizione: "Richiesta integrazione documentale." },
      { concessioneId: concessioniByKey["con-004"], nome: "Determina di aggiornamento canone", tipologia: "DETERMINA", url: "/demo/documenti/determina-aggiornamento-canone-con004.pdf", dataDocumento: daysAgo(200), descrizione: "Revisione annuale canone." },
      { concessioneId: concessioniByKey["con-004"], nome: "Planimetria box tecnico", tipologia: "PLANIMETRIA", url: "/demo/documenti/planimetria-box-tecnico-con004.pdf", dataDocumento: daysAgo(310), descrizione: "Distribuzione interna locali." },
      { concessioneId: concessioniByKey["con-005"], nome: "Diffida ad adempiere prescrizioni", tipologia: "DIFFIDA", url: "/demo/documenti/diffida-adempimenti-con005.pdf", dataDocumento: daysAgo(12), descrizione: "Diffida su aggiornamento sicurezza." },
      { concessioneId: concessioniByKey["con-006"], nome: "Contestazione irregolarita documentale", tipologia: "CONTESTAZIONE", url: "/demo/documenti/contestazione-documentale-con006.pdf", dataDocumento: daysAgo(40), descrizione: "Mancata trasmissione relazione semestrale." },
      { concessioneId: concessioniByKey["con-006"], nome: "Verbale sopralluogo capannone", tipologia: "VERBALE", url: "/demo/documenti/verbale-sopralluogo-capannone-con006.pdf", dataDocumento: daysAgo(35), descrizione: "Rilievi su stato manutentivo." },
      { concessioneId: concessioniByKey["con-007"], nome: "Cauzione a garanzia obblighi", tipologia: "CAUZIONE", url: "/demo/documenti/cauzione-garanzia-con007.pdf", dataDocumento: daysAgo(300), descrizione: "Deposito cauzionale in rinnovo." },
      { concessioneId: concessioniByKey["con-007"], nome: "Ricevuta pagamento parziale", tipologia: "PAGAMENTO", url: "/demo/documenti/pagamento-parziale-con007.pdf", dataDocumento: daysAgo(22), descrizione: "Versamento parziale canone anno corrente." },
      { concessioneId: concessioniByKey["con-008"], nome: "Nota tecnica area multifunzione", tipologia: "NOTA", url: "/demo/documenti/nota-tecnica-area-multifunzione-con008.pdf", dataDocumento: daysAgo(9), descrizione: "Linee guida per uso area." },
    ],
  });

  const criticitaRows = [
    {
      key: "crit-001",
      concessioneKey: "con-002",
      tipologia: "MOROSITA",
      gravita: "URGENTE",
      fonte: "VERIFICA_DOCUMENTALE",
      descrizione: "Morosita canone annuale con rate insolute.",
      riferimentoNormativo: "art. 18 l. 84/1994",
      azioneConsigliata: "Attivare recupero canoni e piano rientro formalizzato.",
      stato: "IN_GESTIONE",
      dataRilevazione: daysAgo(15),
      dataUltimoAggiornamento: daysAgo(2),
    },
    {
      key: "crit-002",
      concessioneKey: "con-003",
      tipologia: "DOCUMENTALE",
      gravita: "ALTA",
      fonte: "VERIFICA_DOCUMENTALE",
      descrizione: "Polizza scaduta senza evidenza di rinnovo.",
      riferimentoNormativo: "art. 46 cod. nav.",
      azioneConsigliata: "Richiedere rinnovo immediato con sospensione operativita in difetto.",
      stato: "APERTA",
      dataRilevazione: daysAgo(8),
      dataUltimoAggiornamento: daysAgo(1),
    },
    {
      key: "crit-003",
      concessioneKey: "con-001",
      tipologia: "OCCUPAZIONE_DIFFORME",
      gravita: "MEDIA",
      fonte: "SOPRALLUOGO",
      descrizione: "Occupazione difforme rispetto alla planimetria assentita.",
      riferimentoNormativo: "art. 54 cod. nav.",
      azioneConsigliata: "Rilievo planimetrico aggiornato e ordine di ripristino.",
      stato: "IN_GESTIONE",
      dataRilevazione: daysAgo(22),
      dataUltimoAggiornamento: daysAgo(6),
    },
    {
      key: "crit-004",
      concessioneKey: "con-005",
      tipologia: "USO_NON_CONFORME",
      gravita: "ALTA",
      fonte: "SEGNALAZIONE",
      descrizione: "Uso non conforme dei locali per attivita non autorizzata.",
      riferimentoNormativo: "art. 45-bis cod. nav.",
      azioneConsigliata: "Convocare concessionario per chiarimenti e adeguamento immediato.",
      stato: "APERTA",
      dataRilevazione: daysAgo(30),
      dataUltimoAggiornamento: daysAgo(10),
    },
    {
      key: "crit-005",
      concessioneKey: "con-006",
      tipologia: "RISCHIO_DECADENZA",
      gravita: "URGENTE",
      fonte: "VERIFICA_DOCUMENTALE",
      descrizione: "Possibile decadenza ex art. 47 cod. nav. per reiterate inadempienze.",
      riferimentoNormativo: "art. 47 cod. nav.",
      azioneConsigliata: "Valutare avvio procedimento di decadenza.",
      stato: "IN_GESTIONE",
      dataRilevazione: daysAgo(40),
      dataUltimoAggiornamento: daysAgo(3),
    },
    {
      key: "crit-006",
      concessioneKey: "con-007",
      tipologia: "RISCHIO_REVOCA",
      gravita: "ALTA",
      fonte: "SEGNALAZIONE",
      descrizione: "Possibile revoca ex art. 42 cod. nav. per gravi disservizi reiterati.",
      riferimentoNormativo: "art. 42 cod. nav.",
      azioneConsigliata: "Istruttoria tecnica e giuridica con contraddittorio.",
      stato: "APERTA",
      dataRilevazione: daysAgo(12),
      dataUltimoAggiornamento: daysAgo(4),
    },
    {
      key: "crit-007",
      concessioneKey: "con-003",
      tipologia: "ECONOMICA",
      gravita: "MEDIA",
      fonte: "ALERT_AUTOMATICO",
      descrizione: "Garanzia scaduta con copertura insufficiente.",
      riferimentoNormativo: "art. 46 cod. nav.",
      azioneConsigliata: "Richiedere nuova garanzia a prima richiesta.",
      stato: "APERTA",
      dataRilevazione: daysAgo(18),
      dataUltimoAggiornamento: daysAgo(7),
    },
    {
      key: "crit-008",
      concessioneKey: "con-006",
      tipologia: "DOCUMENTALE",
      gravita: "MEDIA",
      fonte: "VERIFICA_DOCUMENTALE",
      descrizione: "Documentazione periodica mancante per due semestri.",
      riferimentoNormativo: "art. 18 l. 84/1994",
      azioneConsigliata: "Richiedere deposito relazione tecnica aggiornata.",
      stato: "IN_GESTIONE",
      dataRilevazione: daysAgo(55),
      dataUltimoAggiornamento: daysAgo(9),
    },
    {
      key: "crit-009",
      concessioneKey: "con-006",
      tipologia: "MANUTENTIVA",
      gravita: "ALTA",
      fonte: "SOPRALLUOGO",
      descrizione: "Cattivo stato manutentivo del manufatto con infiltrazioni.",
      riferimentoNormativo: "art. 54 cod. nav.",
      azioneConsigliata: "Intervento urgente con cronoprogramma lavori.",
      stato: "APERTA",
      dataRilevazione: daysAgo(27),
      dataUltimoAggiornamento: daysAgo(5),
    },
    {
      key: "crit-010",
      concessioneKey: "con-001",
      tipologia: "TECNICA",
      gravita: "BASSA",
      fonte: "SEGNALAZIONE",
      descrizione: "Interferenza operativa con concessionario confinante.",
      riferimentoNormativo: "art. 45-bis cod. nav.",
      azioneConsigliata: "Allineare segnaletica e fasce operative condivise.",
      stato: "IN_GESTIONE",
      dataRilevazione: daysAgo(11),
      dataUltimoAggiornamento: daysAgo(2),
    },
  ] as const;

  const criticitaByKey: Record<string, string> = {};
  for (const item of criticitaRows) {
    const created = await prisma.criticita.create({
      data: {
        concessioneId: concessioniByKey[item.concessioneKey],
        tipologia: item.tipologia,
        gravita: item.gravita,
        fonte: item.fonte,
        descrizione: item.descrizione,
        riferimentoNormativo: item.riferimentoNormativo,
        azioneConsigliata: item.azioneConsigliata,
        stato: item.stato,
        dataRilevazione: item.dataRilevazione,
        dataUltimoAggiornamento: item.dataUltimoAggiornamento,
      },
    });
    criticitaByKey[item.key] = created.id;
  }

  await prisma.sopralluogo.createMany({
    data: [
      {
        concessioneId: concessioniByKey["con-001"],
        data: daysAgo(25),
        operatori: "Squadra Tecnica A",
        esito: "POSITIVO",
        conformitaPlanimetrica: true,
        statoManutentivo: "Buono",
        sicurezza: "Conforme",
        occupazione: "Regolare",
        interferenze: "Nessuna",
        descrizione: "Sopralluogo periodico senza rilievi significativi.",
      },
      {
        concessioneId: concessioniByKey["con-004"],
        data: daysAgo(18),
        operatori: "Squadra Tecnica B",
        esito: "POSITIVO",
        conformitaPlanimetrica: true,
        statoManutentivo: "Discreto",
        sicurezza: "Conforme",
        occupazione: "Regolare",
        interferenze: "Nessuna",
        descrizione: "Verifica positiva con raccomandazione su segnaletica interna.",
      },
      {
        concessioneId: concessioniByKey["con-002"],
        data: daysAgo(14),
        operatori: "Squadra Mista C",
        esito: "CON_RILIEVI",
        conformitaPlanimetrica: true,
        statoManutentivo: "Da migliorare",
        sicurezza: "Parzialmente conforme",
        occupazione: "Regolare",
        interferenze: "Limitate",
        descrizione: "Rilievi su parabordi e dispositivi antincendio.",
      },
      {
        concessioneId: concessioniByKey["con-006"],
        data: daysAgo(35),
        operatori: "Squadra Tecnica D",
        esito: "CON_RILIEVI",
        conformitaPlanimetrica: false,
        statoManutentivo: "Scarso",
        sicurezza: "Criticita su vie di fuga",
        occupazione: "Con aree improprie",
        interferenze: "Moderate",
        descrizione: "Rilevate non conformita manutentive e uso difforme.",
      },
      {
        concessioneId: concessioniByKey["con-005"],
        data: daysAgo(9),
        operatori: "Squadra Ispettiva E",
        esito: "NEGATIVO",
        conformitaPlanimetrica: false,
        statoManutentivo: "Insufficiente",
        sicurezza: "Non conforme",
        occupazione: "Difforme",
        interferenze: "Elevate",
        descrizione: "Esito negativo: riscontrato uso non conforme e carenze sicurezza.",
      },
    ],
  });

  await prisma.procedimento.createMany({
    data: [
      {
        concessioneId: concessioniByKey["con-005"],
        criticitaId: criticitaByKey["crit-004"],
        tipologia: "CHIARIMENTI",
        riferimentoNormativo: "art. 45-bis cod. nav.",
        dataAvvio: daysAgo(20),
        dataScadenzaContraddittorio: daysFromNow(10),
        stato: "IN_CORSO",
        noteIstruttorie:
          "Verificare invio comunicazione di avvio procedimento, termine per controdeduzioni e documentazione fotografica.",
      },
      {
        concessioneId: concessioniByKey["con-002"],
        criticitaId: criticitaByKey["crit-001"],
        tipologia: "DIFFIDA",
        riferimentoNormativo: "art. 18 l. 84/1994",
        dataAvvio: daysAgo(14),
        dataScadenzaContraddittorio: daysFromNow(16),
        stato: "IN_CORSO",
        noteIstruttorie:
          "Verificare invio comunicazione di avvio procedimento, termine per controdeduzioni e documentazione fotografica.",
      },
      {
        concessioneId: concessioniByKey["con-006"],
        criticitaId: criticitaByKey["crit-008"],
        tipologia: "CONTESTAZIONE",
        riferimentoNormativo: "art. 18 l. 84/1994",
        dataAvvio: daysAgo(28),
        dataScadenzaContraddittorio: daysFromNow(5),
        stato: "IN_CORSO",
        noteIstruttorie:
          "Verificare invio comunicazione di avvio procedimento, termine per controdeduzioni e documentazione fotografica.",
      },
      {
        concessioneId: concessioniByKey["con-001"],
        criticitaId: criticitaByKey["crit-003"],
        tipologia: "ORDINE_RIPRISTINO",
        riferimentoNormativo: "art. 54 cod. nav.",
        dataAvvio: daysAgo(12),
        dataScadenzaContraddittorio: daysFromNow(22),
        stato: "DA_AVVIARE",
        noteIstruttorie:
          "Verificare invio comunicazione di avvio procedimento, termine per controdeduzioni e documentazione fotografica.",
      },
      {
        concessioneId: concessioniByKey["con-003"],
        criticitaId: criticitaByKey["crit-001"],
        tipologia: "RECUPERO_CANONI",
        riferimentoNormativo: "art. 18 l. 84/1994",
        dataAvvio: daysAgo(7),
        dataScadenzaContraddittorio: daysFromNow(30),
        stato: "IN_CORSO",
        noteIstruttorie:
          "Verificare invio comunicazione di avvio procedimento, termine per controdeduzioni e documentazione fotografica.",
      },
      {
        concessioneId: concessioniByKey["con-006"],
        criticitaId: criticitaByKey["crit-005"],
        tipologia: "AVVIO_DECADENZA",
        riferimentoNormativo: "art. 47 cod. nav.",
        dataAvvio: daysAgo(9),
        dataScadenzaContraddittorio: daysFromNow(21),
        stato: "IN_CORSO",
        noteIstruttorie:
          "Verificare invio comunicazione di avvio procedimento, termine per controdeduzioni e documentazione fotografica.",
      },
      {
        concessioneId: concessioniByKey["con-007"],
        criticitaId: criticitaByKey["crit-006"],
        tipologia: "AVVIO_REVOCA",
        riferimentoNormativo: "art. 42 cod. nav.",
        dataAvvio: daysAgo(6),
        dataScadenzaContraddittorio: daysFromNow(24),
        stato: "DA_AVVIARE",
        noteIstruttorie:
          "Verificare invio comunicazione di avvio procedimento, termine per controdeduzioni e documentazione fotografica.",
      },
      {
        concessioneId: concessioniByKey["con-002"],
        tipologia: "NUOVA_PROCEDURA",
        riferimentoNormativo: "art. 18 l. 84/1994",
        dataAvvio: daysAgo(3),
        dataScadenzaContraddittorio: daysFromNow(40),
        stato: "DA_AVVIARE",
        noteIstruttorie:
          "Verificare invio comunicazione di avvio procedimento, termine per controdeduzioni e documentazione fotografica.",
      },
    ],
  });

  await prisma.report.createMany({
    data: [
      {
        tipologia: "REPORT_MENSILE",
        titolo: "Report mensile monitoraggio - giugno 2026",
        contenuto:
          "Sintesi mensile delle principali variazioni su concessioni attive, scadenze e criticita in gestione.",
        formato: "PDF",
        validato: true,
      },
      {
        concessioneId: concessioniByKey["con-006"],
        tipologia: "REPORT_CRITICITA",
        titolo: "Report criticita capannone con-006",
        contenuto:
          "Focus su criticita manutentive e documentali con proposta di azioni prioritarie entro 30 giorni.",
        formato: "PDF",
        validato: false,
      },
      {
        tipologia: "REPORT_MOROSITA",
        titolo: "Report morosita canoni Q2 2026",
        contenuto:
          "Elenco posizioni con canoni scaduti o parzialmente versati e stato attivita di recupero.",
        formato: "PDF",
        validato: true,
      },
      {
        tipologia: "REPORT_SCADENZE",
        titolo: "Report scadenze prossimi 90 giorni",
        contenuto:
          "Scadenze concessorie, polizze e termini procedimentali in agenda operativa.",
        formato: "PDF",
        validato: true,
      },
      {
        concessioneId: concessioniByKey["con-005"],
        tipologia: "DOSSIER_ISTRUTTORIO",
        titolo: "Dossier istruttorio concessione con-005",
        contenuto:
          "Raccolta sintetica degli elementi istruttori su uso non conforme e prescrizioni sicurezza.",
        formato: "PDF",
        validato: false,
      },
      {
        tipologia: "PROPOSTA_BANDO",
        titolo: "Proposta bando area banchina est",
        contenuto:
          "Bozza di impostazione tecnico-economica per nuova procedura concessoria su area strategica.",
        formato: "PDF",
        validato: false,
      },
    ],
  });

  const normaFontiData = [
    {
      codice: "ART_42_COD_NAV",
      titolo: "Art. 42 Codice della Navigazione",
      enteEmittente: "Stato",
      ambito: "PROCEDIMENTI",
      descrizione: "Disciplina revoca della concessione per sopravvenuto interesse pubblico.",
      versioni: [
        {
          versione: "v2024.1",
          stato: "VIGENTE",
          dataEntrataVigore: new Date("2024-01-01"),
          dataFineVigore: null,
          urlTesto: "https://www.normattiva.it/",
          sintesi: "La revoca richiede motivazione puntuale su interesse pubblico e valutazione degli impatti.",
          note: "Da coordinare con fascicolo istruttorio e contraddittorio.",
        },
      ],
    },
    {
      codice: "ART_47_COD_NAV",
      titolo: "Art. 47 Codice della Navigazione",
      enteEmittente: "Stato",
      ambito: "PROCEDIMENTI",
      descrizione: "Disciplina cause e presupposti di decadenza della concessione.",
      versioni: [
        {
          versione: "v2024.1",
          stato: "VIGENTE",
          dataEntrataVigore: new Date("2024-01-01"),
          dataFineVigore: null,
          urlTesto: "https://www.normattiva.it/",
          sintesi: "La decadenza richiede inadempienza accertata, contraddittorio e proporzionalita del provvedimento.",
          note: "Particolare attenzione ai casi di morosita reiterata e uso non conforme.",
        },
      ],
    },
    {
      codice: "ART_18_L84_1994",
      titolo: "Art. 18 Legge 84/1994",
      enteEmittente: "Stato",
      ambito: "CONCESSIONI",
      descrizione: "Rilascio e gestione delle concessioni demaniali marittime in ambito portuale.",
      versioni: [
        {
          versione: "v2023.2",
          stato: "VIGENTE",
          dataEntrataVigore: new Date("2023-07-01"),
          dataFineVigore: null,
          urlTesto: "https://www.normattiva.it/",
          sintesi: "Definisce presupposti, durata e condizioni essenziali del rapporto concessorio.",
          note: "Usata come riferimento trasversale nei moduli concessioni e report.",
        },
      ],
    },
    {
      codice: "ART_54_COD_NAV",
      titolo: "Art. 54 Codice della Navigazione",
      enteEmittente: "Stato",
      ambito: "SICUREZZA",
      descrizione: "Poteri di ordine e ripristino in caso di occupazione o uso difforme.",
      versioni: [
        {
          versione: "v2024.1",
          stato: "VIGENTE",
          dataEntrataVigore: new Date("2024-01-01"),
          dataFineVigore: null,
          urlTesto: "https://www.normattiva.it/",
          sintesi: "Consente ordine di ripristino e misure operative a tutela del demanio marittimo.",
          note: "Rilevante per criticita tecnico-manutentive e uso difforme.",
        },
      ],
    },
  ] as const;

  const normaFonteByCodice: Record<string, { id: string; ambito: string; titolo: string }> = {};
  const normaVersioneByKey: Record<string, string> = {};

  for (const fonte of normaFontiData) {
    const upsertedFonte = await prisma.normaFonte.upsert({
      where: { codice: fonte.codice },
      create: {
        codice: fonte.codice,
        titolo: fonte.titolo,
        enteEmittente: fonte.enteEmittente,
        ambito: fonte.ambito,
        descrizione: fonte.descrizione,
      },
      update: {
        titolo: fonte.titolo,
        enteEmittente: fonte.enteEmittente,
        ambito: fonte.ambito,
        descrizione: fonte.descrizione,
      },
    });

    normaFonteByCodice[fonte.codice] = {
      id: upsertedFonte.id,
      ambito: upsertedFonte.ambito,
      titolo: upsertedFonte.titolo,
    };

    for (const versione of fonte.versioni) {
      const upsertedVersione = await prisma.normaVersione.upsert({
        where: {
          normaFonteId_versione: {
            normaFonteId: upsertedFonte.id,
            versione: versione.versione,
          },
        },
        create: {
          normaFonteId: upsertedFonte.id,
          versione: versione.versione,
          stato: versione.stato,
          dataEntrataVigore: versione.dataEntrataVigore,
          dataFineVigore: versione.dataFineVigore,
          urlTesto: versione.urlTesto,
          sintesi: versione.sintesi,
          note: versione.note,
        },
        update: {
          stato: versione.stato,
          dataEntrataVigore: versione.dataEntrataVigore,
          dataFineVigore: versione.dataFineVigore,
          urlTesto: versione.urlTesto,
          sintesi: versione.sintesi,
          note: versione.note,
        },
      });

      normaVersioneByKey[`${fonte.codice}:${versione.versione}`] = upsertedVersione.id;
    }
  }

  const reportRows = await prisma.report.findMany({
    select: { id: true, tipologia: true },
  });

  const reportByTipologia = Object.fromEntries(reportRows.map((item) => [item.tipologia, item.id]));

  type NormImpactSeed = {
    normaCodice: string;
    versione: string;
    modulo: "CRITICITA" | "PROCEDIMENTI" | "REPORT";
    severita: "URGENTE" | "ALTA" | "MEDIA";
    descrizione: string;
    azioneRichiesta: string;
    concessioneId: string | null;
    criticitaId: string | null;
    procedimentoId: string | null;
    reportId: string | null;
  };

  const impacts: NormImpactSeed[] = [
    {
      normaCodice: "ART_47_COD_NAV",
      versione: "v2024.1",
      modulo: "CRITICITA",
      severita: "URGENTE",
      descrizione: "Le criticita per morosita e rischio decadenza richiedono istruttoria con presidio contraddittorio.",
      azioneRichiesta: "Valutare avvio procedimento di decadenza se inadempienza reiterata.",
      criticitaId: criticitaByKey["crit-005"],
      concessioneId: concessioniByKey["con-006"],
      procedimentoId: null,
      reportId: null,
    },
    {
      normaCodice: "ART_42_COD_NAV",
      versione: "v2024.1",
      modulo: "PROCEDIMENTI",
      severita: "ALTA",
      descrizione: "I procedimenti di revoca necessitano motivazione rafforzata su interesse pubblico.",
      azioneRichiesta: "Documentare comparazione interessi e impatti economici.",
      procedimentoId: null,
      concessioneId: concessioniByKey["con-007"],
      criticitaId: null,
      reportId: null,
    },
    {
      normaCodice: "ART_54_COD_NAV",
      versione: "v2024.1",
      modulo: "PROCEDIMENTI",
      severita: "ALTA",
      descrizione: "Le occupazioni difformi possono richiedere ordine di ripristino con verifica tecnica.",
      azioneRichiesta: "Programmare sopralluogo tecnico e formalizzare prescrizioni.",
      procedimentoId: null,
      criticitaId: criticitaByKey["crit-003"],
      concessioneId: concessioniByKey["con-001"],
      reportId: null,
    },
    {
      normaCodice: "ART_18_L84_1994",
      versione: "v2023.2",
      modulo: "REPORT",
      severita: "MEDIA",
      descrizione: "La reportistica periodica deve mantenere tracciabilita dei riferimenti concessori essenziali.",
      azioneRichiesta: "Confermare coerenza tra report, stato concessione e scadenze operative.",
      reportId: reportByTipologia["REPORT_MENSILE"],
      concessioneId: null,
      criticitaId: null,
      procedimentoId: null,
    },
  ];

  const procedimentiRows = await prisma.procedimento.findMany({
    select: { id: true, tipologia: true, concessioneId: true },
  });
  const procedimentoDecadenza = procedimentiRows.find((item) => item.tipologia === "AVVIO_DECADENZA");
  const procedimentoRevoca = procedimentiRows.find((item) => item.tipologia === "AVVIO_REVOCA");
  const procedimentoRipristino = procedimentiRows.find((item) => item.tipologia === "ORDINE_RIPRISTINO");

  const finalizedImpacts = impacts.map((item) => {
    if (item.normaCodice === "ART_47_COD_NAV") {
      return {
        ...item,
        procedimentoId: procedimentoDecadenza?.id ?? null,
      };
    }

    if (item.normaCodice === "ART_42_COD_NAV") {
      return {
        ...item,
        procedimentoId: procedimentoRevoca?.id ?? null,
      };
    }

    if (item.normaCodice === "ART_54_COD_NAV") {
      return {
        ...item,
        procedimentoId: procedimentoRipristino?.id ?? null,
      };
    }

    return {
      ...item,
      procedimentoId: null,
    };
  });

  for (const impact of finalizedImpacts) {
    const normaFonteId = normaFonteByCodice[impact.normaCodice]?.id;
    const normaVersioneId = normaVersioneByKey[`${impact.normaCodice}:${impact.versione}`];

    if (!normaFonteId || !normaVersioneId) {
      continue;
    }

    await prisma.normaImpatto.create({
      data: {
        normaFonteId,
        normaVersioneId,
        modulo: impact.modulo,
        severita: impact.severita,
        descrizione: impact.descrizione,
        azioneRichiesta: impact.azioneRichiesta,
        concessioneId: impact.concessioneId,
        criticitaId: impact.criticitaId ?? null,
        procedimentoId: impact.procedimentoId ?? null,
        reportId: impact.reportId ?? null,
      },
    });
  }

  await prisma.activityLog.createMany({
    data: [
      {
        userId: userByEmail["admin.demo@concessioni.local"],
        concessioneId: concessioniByKey["con-001"],
        azione: "CREAZIONE_CONCESSIONE",
        entita: "Concessione",
        entitaId: concessioniByKey["con-001"],
        descrizione: "Inserita nuova concessione CP-001/2021 in anagrafica.",
      },
      {
        userId: userByEmail["pm.demo@concessioni.local"],
        concessioneId: concessioniByKey["con-002"],
        azione: "AGGIORNAMENTO_CRITICITA",
        entita: "Criticita",
        entitaId: criticitaByKey["crit-001"],
        descrizione: "Aggiornato stato criticita morosita a IN_GESTIONE.",
      },
      {
        userId: userByEmail["tecnico.demo@concessioni.local"],
        concessioneId: concessioniByKey["con-006"],
        azione: "CARICAMENTO_DOCUMENTO",
        entita: "Documento",
        descrizione: "Caricato verbale sopralluogo capannone.",
      },
      {
        userId: userByEmail["giuridico.demo@concessioni.local"],
        concessioneId: concessioniByKey["con-006"],
        azione: "APERTURA_PROCEDIMENTO",
        entita: "Procedimento",
        descrizione: "Aperto procedimento AVVIO_DECADENZA.",
      },
      {
        userId: userByEmail["economico.demo@concessioni.local"],
        concessioneId: concessioniByKey["con-003"],
        azione: "REGISTRAZIONE_PAGAMENTO",
        entita: "Pagamento",
        descrizione: "Registrato pagamento parziale annualita 2026.",
      },
      {
        userId: userByEmail["pm.demo@concessioni.local"],
        azione: "GENERAZIONE_REPORT",
        entita: "Report",
        descrizione: "Generato report scadenze prossimi 90 giorni.",
      },
      {
        userId: userByEmail["admin.demo@concessioni.local"],
        concessioneId: concessioniByKey["con-007"],
        azione: "ASSEGNAZIONE_ATTIVITA",
        entita: "Concessione",
        entitaId: concessioniByKey["con-007"],
        descrizione: "Assegnata priorita alta per verifica polizza.",
      },
      {
        userId: userByEmail["viewer.adsp.demo@concessioni.local"],
        concessioneId: concessioniByKey["con-002"],
        azione: "CONSULTAZIONE_DOSSIER",
        entita: "Report",
        descrizione: "Consultato dossier procedimentale concessione CP-014/2020.",
      },
      {
        userId: userByEmail["giuridico.demo@concessioni.local"],
        concessioneId: concessioniByKey["con-005"],
        azione: "AGGIORNAMENTO_PROCEDIMENTO",
        entita: "Procedimento",
        descrizione: "Aggiornata nota istruttoria su richiesta chiarimenti.",
      },
      {
        userId: userByEmail["tecnico.demo@concessioni.local"],
        concessioneId: concessioniByKey["con-001"],
        azione: "CHIUSURA_SOPRALLUOGO",
        entita: "Sopralluogo",
        descrizione: "Chiuso sopralluogo con esito positivo.",
      },
    ],
  });

  const counts = {
    users: await prisma.user.count(),
    concessionari: await prisma.concessionario.count(),
    concessioni: await prisma.concessione.count(),
    normeFonte: await prisma.normaFonte.count(),
    normeVersione: await prisma.normaVersione.count(),
    normeImpatto: await prisma.normaImpatto.count(),
    obblighiConcessori: await prisma.obbligoConcessorio.count(),
    scadenze: await prisma.scadenza.count(),
    pagamenti: await prisma.pagamento.count(),
    documenti: await prisma.documento.count(),
    criticita: await prisma.criticita.count(),
    sopralluoghi: await prisma.sopralluogo.count(),
    procedimenti: await prisma.procedimento.count(),
    report: await prisma.report.count(),
    activityLogs: await prisma.activityLog.count(),
  };

  console.log("Seed completato con i seguenti volumi:");
  console.table(counts);
}

main()
  .catch((error) => {
    console.error("Errore durante il seed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
