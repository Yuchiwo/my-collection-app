// Firebase Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAbWP1rhmgoG1R6e3R7hwdOex2PN1Bbpyc",
    authDomain: "my-collection-app-b1296.firebaseapp.com",
    projectId: "my-collection-app-b1296",
    storageBucket: "my-collection-app-b1296.firebasestorage.app",
    messagingSenderId: "495379519784",
    appId: "1:495379519784:web:c180f2816eb2d9c445981d"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, setDoc };
