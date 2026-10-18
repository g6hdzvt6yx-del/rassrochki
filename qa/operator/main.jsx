import React from 'react';
import {createRoot} from 'react-dom/client';
import OperatorDesk from '../../src/OperatorDesk';
import '../../src/webAccess.css';
createRoot(document.getElementById('root')).render(<><p style={{padding:12,background:'#fff2c5',fontFamily:'system-ui'}}>Проверка интерфейса · вымышленные данные · записи не отправляются в Supabase</p><OperatorDesk onLogout={()=>location.reload()}/></>);
