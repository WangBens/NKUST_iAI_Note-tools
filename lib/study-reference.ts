/** Reviewed standard-model explanations. Selected only for concepts recognized
 * in the source, never by filename. No reconstructed numerical examples. */
export const STUDY_REFERENCES: Record<string, string> = {
  'power-chain': `## 直流電源處理流程（DC Power Supply Chain）

傳統變壓器式電源的功能順序是：**變壓 → 整流 → 濾波 → 穩壓**。

- 變壓器 Transformer 透過電磁耦合調整交流電壓等級。
- 整流器 Rectifier 利用二極體把交流變成單向脈動電壓；整流後不等於已經沒有紋波。
- 濾波器 Filter 以電容儲能，減緩波峰之間的輸出下降，降低紋波。
- 穩壓器 Regulator 在規定的輸入與負載範圍內讓輸出較穩定，不是二極體整流或電容濾波的另一個名稱。

分析電源時先辨認每一級的功能，分別畫出交流輸入、整流脈動、濾波與穩壓後的波形，再檢查前級是否能提供後級所需的電壓與電流。`,
  transformer: `## 變壓器（Transformer）

### 工作原理與符號
初級與次級繞組透過共同的主磁通 $\\Phi$ 耦合。$N_1,N_2$ 為匝數；磁通的單位是 Wb，磁鏈分別為 $\\lambda_1=N_1\\Phi$、$\\lambda_2=N_2\\Phi$。共用磁通不代表兩側磁鏈相等。

依 Faraday's Law，選定一致的繞組方向後，感應電動勢為
$$
e_1=-N_1\\frac{d\\Phi}{dt},\\qquad e_2=-N_2\\frac{d\\Phi}{dt}.
$$
負號依所選方向反映 Lenz's Law。端電壓的正負還須配合端點參考方向，不能直接忽略點標記。

### 理想電壓比、電流比與負載
在無繞組電阻、無漏磁、無鐵心損耗，且忽略激磁電流的理想模型下，以下為電壓與電流的大小關係：
$$
\\frac{V_1}{V_2}=\\frac{N_1}{N_2},\\qquad
\\frac{I_1}{I_2}=\\frac{N_2}{N_1}.
$$
兩側採相同的有效值或振幅基準。降壓時，在相應負載下次級電流可以較大；這不代表產生額外能量。次級帶負載後，初級會增加電流以補償次級磁動勢；理想模型以安匝平衡與功率平衡解釋電流比，不能以磁鏈守恆推導。

### 解題順序
先標出初級、次級、匝數與點標記；用匝數比求電壓大小，再依負載求次級電流，最後用反比求初級電流。Dot Convention 表示指定端點的瞬時相對電壓極性，不表示任意選定電流方向必然同號。`,
  diode: `## 二極體模型（Diode Model）

### 端子方向與偏壓
$v_D=v_A-v_K$ 為陽極 Anode 減陰極 Cathode 的端電壓，$i_D$ 的正方向由陽極流向陰極。$v_D>0$ 稱順向偏壓 Forward Bias，$v_D<0$ 稱反向偏壓 Reverse Bias。偏壓方向與近似模型是否導通是不同判斷。

### 理想模型與固定壓降模型
理想模型：導通時 $v_D=0$ 且 $i_D\\ge0$；截止時 $i_D=0$ 且 $v_D\\le0$。

固定順向壓降模型 Constant-Voltage-Drop Model：導通時 $v_D=V_\\gamma$ 且 $i_D\\ge0$；截止時 $i_D=0$ 且 $v_D\\le V_\\gamma$。$V_\\gamma$ 為模型指定的順向壓降，不是電池電壓，也不是訊源振幅。在此近似模型中，$0<v_D<V_\\gamma$ 可以順偏但仍截止；真實二極體沒有完全突變的硬門檻。

### 狀態假設法
1. 選定模型並標出 $v_D,i_D$ 的參考方向。
2. 假設截止，令 $i_D=0$，依完整電路求 $v_D$；固定壓降模型檢查 $v_D\\le V_\\gamma$，而非僅檢查 $v_D<0$。
3. 假設導通，令 $v_D=V_\\gamma$（理想模型為零），由 KVL 求電流並檢查 $i_D\\ge0$。
4. 保留滿足元件與電路條件的解。含多顆二極體時，每顆都須檢查，不可只靠訊源正負猜全部狀態。

逆偏漏電、擊穿與熱效應不在上述簡化模型內；實際選型另須檢查電流、反向額定與散熱。`,
  'load-line': `## 負載線與工作點（Load Line and Operating Point）

對訊源 $v_s$、電阻 $R>0$ 與二極體串聯的電路，由 KVL 得
$$
v_s=v_D+i_D R,\\qquad i_D=\\frac{v_s-v_D}{R}.
$$
以 $v_D$ 為橫軸、$i_D$ 為縱軸，負載線斜率為 $-1/R$；兩軸截距是 $(v_s,0)$ 與 $(0,v_s/R)$。工作點 Operating Point 同時滿足此電路約束與二極體的 $i_D$–$v_D$ 特性。

### 圖解與模型判斷
先畫元件特性，再由兩截距畫負載線，取交點。固定壓降模型的導通支路是 $v_D=V_\\gamma$ 的**垂直線**；截止支路是 $i_D=0$ 的水平支路，不可把兩者顛倒。真實元件特性則是非線性曲線。

訊源改變時，固定 $R$ 的負載線平行位移。負訊源不表示整條無限延伸的直線只在第三象限；在反向漏電及擊穿均忽略的模型中，截止解為 $i_D=0,v_D=v_s$。幾何直線上的其他點不一定是元件可實現的工作點。`,
  battery: `## 二極體充電電路（Diode Charging Circuit）

以下模型限於訊源 $v_s$、限流電阻 $R>0$、二極體與電池 $V_B$ 串聯，且電池極性使正向電流流入正端的充電接法。導通時
$$
v_s=i_D R+V_\\gamma+V_B.
$$
因此
$$
i_D=\\max\\left(0,\\frac{v_s-V_B-V_\\gamma}{R}\\right).
$$
有正充電電流的條件是 $v_s>V_B+V_\\gamma$。比较的是**訊源電壓**，不是二極體自身端電壓。導通時 $v_D=V_\\gamma$；截止時電阻壓降為零，故 $v_D=v_s-V_B$，端電壓仍有明確意義。

若訊源在負峰值為 $-V_m$，本串聯電池充電接法的最大反向電壓為 $\\mathrm{PIV}=V_m+V_B$。這是含電池的電路，不是中心抽頭全波整流的 $2V_m-V_\\gamma$。

### 計算流程
先確認電池與二極體方向，建立 KVL；用門檻判定導通區間，再只在導通區間使用電流式。$v_s,V_B,V_\\gamma$ 都以 V 表示，$R$ 用 Ω，所得電流用 A。代入數字前，先確認每個數值的單位、變數角色與接線位置。`,
  'half-wave': `## 半波整流（Half-Wave Rectifier）

### 無電容、純電阻負載
以正輸出、單顆串聯二極體與負載 $R_L$ 為模型，令 $v_s=V_m\\sin(\\omega t)$，$V_m>0$ 為訊源峰值。
$$
v_o=\\max(0,v_s-V_\\gamma),\\qquad i_D=\\frac{v_o}{R_L}.
$$
理想模型 $V_\\gamma=0$，只有正半週輸出。平均值 DC Component 與有效值 RMS 為
$$
V_{o,\\mathrm{avg}}=\\frac{V_m}{\\pi},\\qquad V_{o,\\mathrm{rms}}=\\frac{V_m}{2}.
$$
這兩式限於理想、無濾波的半波正弦波；固定壓降模型須另外處理截止角，不能直接套用上述平均值再隨意扣一個壓降。

### 反向電壓與濾波條件
負半週截止時，陽極接訊源、陰極經負載為零電位。$v_D=v_s$，所以無電容的 PIV 為 $V_m$。

若加上大濾波電容且穩態紋波很小，陰極維持約 $V_C$；負峰值時陽極為 $-V_m$，因此
$$
\\mathrm{PIV}=V_m+V_C\\approx2V_m-V_\\gamma.
$$
理想模型近似 $2V_m$。含電容與無電容是不同條件，不能共用 $\\mathrm{PIV}=V_m$ 的結論。`,
  'center-tap': `## 中心抽頭全波整流（Center-Tapped Full-Wave Rectifier）

### 接線與電壓基準
以下為正輸出接法：中心抽頭接 $0$ V；兩顆二極體陽極分別接次級兩端，陰極共接輸出，負載接輸出與抽頭之間。

令 $V_m$ 為**單邊相對抽頭的峰值**，兩端對抽頭的瞬時電壓為
$$
v_{s1}=V_m\\sin\\theta,\\qquad v_{s2}=-V_m\\sin\\theta.
$$
端到端瞬時電壓為 $2V_m\\sin\\theta$，峰值 $2V_m$、峰對峰值 $4V_m$；不能把峰值與峰對峰值混用。

### 輸出與反向電壓
正、負半週由不同二極體交替導通，純電阻負載、固定壓降模型的輸出為
$$
v_o=\\max(0,V_m|\\sin\\theta|-V_\\gamma).
$$
導通顆的 $v_D=V_\\gamma$，不是 $v_o$。例如 $v_{s1}=+V_m$、$v_{s2}=-V_m$ 時，輸出陰極共點為 $V_m-V_\\gamma$；關斷顆陽極為 $-V_m$，所承受反向電壓為
$$
\\mathrm{PIV}=(V_m-V_\\gamma)-(-V_m)=2V_m-V_\\gamma.
$$
理想模型為 $2V_m$。理想無濾波輸出平均值 $2V_m/\\pi$、RMS 為 $V_m/\\sqrt2$，脈動頻率是訊源頻率的兩倍。解題時先定義單邊峰值，再依陽極、陰極電位相減，不能把抽頭當成正峰值，也不能把電池充電門檻代入此拓撲。`,
  capacitor: `## 電容濾波（Capacitor Filter）

電容 $C$ 與負載 $R_L$ 並聯，儲存能量並在二極體截止時供應負載。$v_C=v_o$ 為電容電壓；不是每個上升半週都立即導通。

### 截止與放電
二極體關斷後，充電訊源與電容隔離；標準模型的放電路徑只有 $R_L$：
$$
v_C(t)=v_C(t_0)\\exp\\left[-\\frac{t-t_0}{R_L C}\\right],\\qquad
\\tau_{\\mathrm{discharge}}=R_L C.
$$
$t_0$ 為開始放電時刻。指數衰減先較陡、後變平。不能把已被二極體隔離的訊源串聯內阻算進這個放電時間常數。

### 再導通與充電
再導通需要訊源足以克服當下 $v_C$ 與導通路徑的總順向壓降，且二極體電流非負。有限充電阻抗下，電容電壓不能瞬間跳變。若充電路徑等效串聯電阻是 $R_s$，導通時還須考慮 $R_L$；簡化線性模型的自然時間常數是 $(R_s\\parallel R_L)C$，在 $R_s\\ll R_L$ 時近似 $R_sC$。不能與截止時的 $R_LC$ 混用。

在理想零串聯阻抗與固定二極體壓降模型中，導通期間 $v_C=v_s-V_{\\mathrm{path}}$，其中 $V_{\\mathrm{path}}$ 為導通路徑總壓降，故
$$
i_D=C\\frac{dv_s}{dt}+\\frac{v_C}{R_L}.
$$
當 $i_D$ 降至零才關斷；導通可能持續到訊源峰值之後，不是過了峰值就必定立即截止。啟動時的充電與穩態補充充電也須分開分析。

### 紋波（Ripple）與設計
小紋波、負載電流近似固定且充電時間很短時，
$$
\\Delta V_C\\approx\\frac{I_L}{f_r C}.
$$
$I_L$ 為負載電流，$f_r$ 為充電脈動頻率：半波約為訊源頻率 $f$，全波約 $2f$。增加 $C$ 或降低負載電流通常可減少紋波；穩態導通窗口一般較短，但須同時考慮峰值充電電流及元件額定。半波電容濾波的 PIV 約為 $2V_m$，不是無電容時的 $V_m$。`,
  'magnetic-rules': `## 電磁方向與電壓極性（Magnetic Field and Voltage Polarity）

### 右手與左手定則
安培右手定則 Right-Hand Grip Rule：直導線的拇指指傳統電流方向，彎曲四指指磁場環繞方向；在線圈中，四指沿繞組電流，拇指指向線圈內磁場方向。

弗萊明左手定則 Fleming's Left-Hand Rule 用於磁場中的受力導線：食指為磁場、中指為傳統電流、拇指為力或運動方向。它不是直接判斷變壓器感應電壓極性的規則。

### 感應與極性判斷
Faraday's Law 給出感應電动勢與磁通變化率的關係 $e=-N\\,d\\Phi/dt$；Lenz's Law 指感應作用反抗造成它的磁通變化。Dot Convention 再標明各繞組指定端點的瞬時相對電壓極性。

判斷時先確認問題是磁場、受力還是感應電壓，再選定電流及繞組方向，最後依定律與端點參考方向標示。這幾種定則不能交換使用，也不能只看到「右手／左手」就猜电壓正負。`,
  transfer: `## 二極體轉移特性（Diode Transfer Characteristic）

轉移特性以输入 $v_s$ 為橫軸、輸出 $v_o$ 為縱軸，與以 $v_D,i_D$ 為軸的元件特性不同。

對訊源、正向二極體、負載電阻串聯，且輸出取在電阻上的單顆二極體整流電路，固定壓降模型為
$$
v_o=\\max(0,v_s-V_\\gamma).
$$
当 $v_s\\le V_\\gamma$ 時輸出為零；導通支路斜率為一。理想模型以 $V_\\gamma=0$ 簡化。若電路加上電池、電容或改為橋式接法，須重新建立该拓撲的輸入輸出關係，不能直接套同一條曲線。

作圖時先標軸與門檻，分別求截止及導通表达式，檢查交界與适用範圍，再畫出分段曲線。`,
  ratings: `## 二極體電流與反向耐壓（Diode Current and Reverse-Voltage Ratings）

### 三種不同的反向電壓概念
- PIV（Peak Inverse Voltage）：這份講義以它表示電路要求二極體承受的最大反向電壓。
- $V_{\\mathrm{RRM}}$（Repetitive Peak Reverse Voltage）：元件資料表的重複峰值反向額定。
- $V_{\\mathrm{BR}}$（Breakdown Voltage）：材料與結構相關的擊穿電壓。

三者不可混為同一定義。選型需讓元件反向額定足以承受電路 PIV 與設計餘裕；超過額定代表超出保證操作範圍，不代表只要超過某個 PIV 数值就必然立刻永久損壞。

### 電流、功率與散熱
二極體瞬時功率 $p_D=v_Di_D$。平均順向電流、峰值或突波電流、反向額定與熱條件都須分别檢查，尤其電容濾波可能產生很高的短時間充電電流。不能只檢查平均負載電流，也不能說晶片面積增加就必然提高反向耐壓。

分析流程：先由波形求每顆二極體的最大反向電壓，再求導通電流與功率，最後對照資料表額定及散熱條件。`,
  'conduction-window': `## 導通區間與時間比例（Conduction Interval and Duty Ratio）

對正弦訊源 $v_s=V_m\\sin\\theta$ 的串聯電池充電電路，令門檻 $V_{\\mathrm{th}}=V_B+V_\\gamma$。在 $0<V_{\\mathrm{th}}<V_m$ 时，
$$
\\theta_0=\\arcsin\\left(\\frac{V_{\\mathrm{th}}}{V_m}\\right).
$$
正半週有正充電電流的區間是 $\\theta_0<\\theta<\\pi-\\theta_0$，寬度 $\\pi-2\\theta_0$。訊源上升與下降時各跨過一次門檻，不能只扣除一側角度。

单顆二極體半波充電相對**整個週期**的導通比例為
$$
D_{\\mathrm{half}}=\\frac{\\pi-2\\theta_0}{2\\pi}.
$$
若相應的全波電路每半週都有相同充電窗口，負載總輸出的比例則為 $(\\pi-2\\theta_0)/\\pi$；單顆二極體的比例與全波總輸出比例不能混用，且橋式门檻须含兩顆二極體壓降。$V_{\\mathrm{th}}\\ge V_m$ 时没有正充電電流。

導通時間比例不等於能量轉換效率。先確認拓撲、測量對象與分母，再解門檻交點、換算時間。`,
  'bridge-comparison': `## 橋式與中心抽頭整流比較（Bridge and Center-Tapped Rectifiers）

橋式整流使用四顆二極體，每半週由不同的兩顆串聯導通，讓負載電流維持同方向。$V_m$ 定義為整個次級兩端的訊源峰值，固定壓降模型為
$$
v_o=\\max(0,|v_s|-2V_\\gamma).
$$
理想模型每顆 PIV 為 $V_m$，脈動頻率為輸入的兩倍。

中心抽頭全波整流每次一顆導通，需有次級抽頭；若 $V_m$ 定義為單邊對抽頭峰值，理想每顆 PIV 為 $2V_m$。其端到端峰值是 $2V_m$，峰對峰值是 $4V_m$。

比較時先統一輸出需求及峰值基準，再檢查導通壓降、反向額定、變壓器繞組需求與電流。兩種電路公式中的 $V_m$ 原本不一定代表同一測量位置，不能直接比較數字，也不能由匝數就斷言成本或鐵心尺寸精確兩倍。`,
  career: `## 專業英文與職涯準備（Technical English and Career Preparation）

課程也强调專業能力與語言能力應一起準備。可提早練習閱讀英文教材、電子元件資料表、設備手冊與英文專有名詞，並把課堂知识用於説明電路与解題流程。

多益 TOEIC（Test of English for International Communication）是英語溝通能力測驗，不是翻譯測驗。應依自己的求學或求職目标安排英語準備，不等到面試或申请時才临時补足。面試時除了證書，也要能説明自己学過什麼、做過什么，以及如何處理實際问题。

可把準備拆成平日的專有名詞與閱讀練習，以及較長時段的英語複習，讓語言訓練與專業課程一起累積。`,
};
STUDY_REFERENCES.bridge = STUDY_REFERENCES['bridge-comparison'];
STUDY_REFERENCES.conduction = STUDY_REFERENCES['conduction-window'];

/** A numerical example is accepted only with all four explicitly identified
 * quantities inside the SAME short raw-source charging episode. Never mine a
 * model draft or unrelated numbers from another chapter. */
export function sourceChargingExample(raw: string) {
  const battery =
    /(?:蓄電池|行動電源|可充電電池|一個電池)[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*(?:V|伏)/i.exec(
      raw,
    );
  if (!battery) return '';
  const source = raw.slice(battery.index, battery.index + 850);
  const r =
    /(?:限流電阻|線流電數|串聯電阻)[^\d]{0,12}(\d+(?:\.\d+)?)\s*(?:歐姆|Ω)/i.exec(
      source,
    );
  const gamma = /導通電壓[^\d]{0,20}(\d+(?:\.\d+)?)/.exec(source);
  const amplitude = /正[弦懸旋]波[^\d]{0,20}(\d+(?:\.\d+)?)\s*(?:V|伏)/i.exec(
    source,
  );
  if (!r || !gamma || !amplitude || !/克服|減掉|充電電流/.test(source))
    return '';
  const vb = Number(battery[1]),
    ohms = Number(r[1]),
    vg = Number(gamma[1]),
    vm = Number(amplitude[1]);
  if (
    !(vb > 0 && ohms > 0 && vg >= 0 && vg <= 2 && vm > vb + vg) ||
    ![vb, ohms, vg, vm].every(Number.isFinite)
  )
    return '';
  const n = (v: number) => Number(v.toFixed(6)).toString();
  const th = vb + vg,
    ma = ((vm - th) / ohms) * 1000,
    angle = (Math.asin(th / vm) * 180) / Math.PI,
    duty = ((180 - 2 * angle) / 360) * 100;
  return `### 錄音中的串聯電池充電例題
來源完整指出：電池 $V_B=${n(vb)}\\,\\mathrm V$、限流電阻 $R=${n(ohms)}\\,\\Omega$、二極體固定壓降 $V_\\gamma=${n(vg)}\\,\\mathrm V$，以及正弦訊源峰值 $V_m=${n(vm)}\\,\\mathrm V$。

1. 導通門檻是 $V_B+V_\\gamma=${n(th)}\\,\\mathrm V$。
2. 正峰值電流為
$$
i_{D,\\max}=\\frac{${n(vm)}-${n(vb)}-${n(vg)}}{${n(ohms)}}\\,\\mathrm A=${n(ma)}\\,\\mathrm{mA}.
$$
3. 負峰值時關斷，陽極為 $-${n(vm)}$ V、陰極為 $+${n(vb)}$ V，故 $\\mathrm{PIV}=${n(vm)}+${n(vb)}=${n(vm + vb)}\\,\\mathrm V$。
4. 門檻角 $\\theta_0=\\arcsin(${n(th)}/${n(vm)})\\approx${angle.toFixed(1)}^\\circ$；導通區間約 ${angle.toFixed(1)}° 至 ${(180 - angle).toFixed(1)}°，相對完整週期的時間比例約 ${duty.toFixed(1)}%，約三分之一。這是半波電池充電的導通時間比例，不是效率，也不是全波總輸出的比例。`;
}
