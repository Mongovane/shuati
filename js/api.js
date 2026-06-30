// 统一管理对 /api/ 的请求与 401 鉴权拦截（Vue mixin，合并进主应用）
const ApiMixin = {
  methods: {
    async api(path,opts={}){
      const headers=Object.assign({'authorization':'Bearer '+this.token}, opts.headers||{});
      if(opts.body) headers['content-type']='application/json';
      const res=await fetch(path,{ ...opts, headers });
      let data=null; try{ data=await res.json(); }catch(e){}
      if(res.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.view='settings'; this.flash('访问码无效，请重新输入',true); throw new Error('unauth'); }
      if(!res.ok) throw new Error((data&&data.error)||('请求失败 '+res.status));
      return data;
    },
  }
};
